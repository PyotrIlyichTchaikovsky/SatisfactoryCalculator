from __future__ import annotations

from dataclasses import replace
import json
import asyncio
import logging
import threading
from unittest.mock import patch
import sys
import unittest
from pathlib import Path
from typing import Any


RECIPE_WEB_DIR = Path(__file__).resolve().parents[1] / "recipe_web"
sys.path.insert(0, str(RECIPE_WEB_DIR))

import production_planner_app  # noqa: E402


class ProductionPlannerAppTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        production_planner_app.app.last_monitoring_test = float("-inf")
        self.original_settings = production_planner_app.app.settings
        production_planner_app.plan_cache._entries.clear()

    def tearDown(self) -> None:
        production_planner_app.app.settings = self.original_settings

    async def call_app(
        self,
        method: str,
        path: str,
        body: bytes = b"",
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        messages: list[dict[str, Any]] = []
        sent_body = False

        async def receive() -> dict[str, Any]:
            nonlocal sent_body
            if sent_body:
                return {"type": "http.request", "body": b"", "more_body": False}
            sent_body = True
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message: dict[str, Any]) -> None:
            messages.append(message)

        await production_planner_app.app(
            {
                "type": "http",
                "method": method,
                "path": path,
                "headers": [
                    (key.lower().encode("latin-1"), value.encode("latin-1"))
                    for key, value in (headers or {}).items()
                ],
            },
            receive,
            send,
        )

        start = next(message for message in messages if message["type"] == "http.response.start")
        response_body = b"".join(
            message.get("body", b"")
            for message in messages
            if message["type"] == "http.response.body"
        )
        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in start["headers"]
        }
        return int(start["status"]), headers, response_body

    async def test_request_ids_are_unique_and_correlate_with_logs(self) -> None:
        with self.assertLogs("production_planner", level="INFO") as logs:
            responses = await asyncio.gather(
                self.call_app("GET", "/api/health", headers={"X-Request-ID": "forged"}),
                self.call_app("GET", "/api/summary"),
            )
        ids = [headers["x-request-id"] for _, headers, _ in responses]
        self.assertNotEqual(ids[0], ids[1])
        self.assertTrue(all(len(value) == 32 for value in ids))
        self.assertEqual(production_planner_app.request_id_context.get(), "")
        self.assertTrue(all("x-planner-data-version" in headers for _, headers, _ in responses))

    async def test_error_response_id_matches_capture_and_log(self) -> None:
        captured = []
        def capture(exc):
            captured.append(production_planner_app.request_id_context.get())
        log_ids = []
        class Recorder(logging.Handler):
            def emit(self, record):
                log_ids.append(json.loads(production_planner_app.JsonLogFormatter().format(record)))
        handler = Recorder()
        production_planner_app.logger.addHandler(handler)
        try:
            with patch.object(production_planner_app.planner, "plan", side_effect=RuntimeError("private failure")), patch.object(production_planner_app, "capture_exception", side_effect=capture):
                status, headers, body = await self.call_app("POST", "/api/plan", b'{"targets":[]}')
        finally:
            production_planner_app.logger.removeHandler(handler)
        self.assertEqual(status, 500)
        self.assertNotIn(b"private failure", body)
        self.assertEqual(captured, [headers["x-request-id"]])
        self.assertTrue(all(row["request_id"] == headers["x-request-id"] for row in log_ids))
        self.assertEqual(log_ids[-1]["status"], 500)

    async def test_validation_errors_have_id_without_exception_capture(self) -> None:
        with patch.object(production_planner_app, "capture_exception") as capture:
            status, headers, body = await self.call_app("POST", "/api/plan", b'{"targets":[]}')
        self.assertEqual(status, 400)
        self.assertIn("x-request-id", headers)
        capture.assert_not_called()

    async def test_late_worker_failure_keeps_original_request_id(self) -> None:
        release_worker = threading.Event()
        captured = []
        def fail_later(*args, **kwargs):
            release_worker.wait(timeout=2)
            raise RuntimeError("late failure")
        def capture(exc):
            captured.append(production_planner_app.request_id_context.get())
        production_planner_app.app.settings = replace(self.original_settings, plan_timeout_seconds=0.001)
        with patch.object(production_planner_app.planner, "plan", side_effect=fail_later), patch.object(production_planner_app, "capture_exception", side_effect=capture):
            try:
                status, headers, body = await self.call_app("POST", "/api/plan", b'{"targets":[]}')
                self.assertEqual(status, 503)
            finally:
                release_worker.set()
            for _ in range(100):
                if captured:
                    break
                await asyncio.sleep(0.01)
        self.assertEqual(captured, [headers["x-request-id"]])
        self.assertEqual(production_planner_app.request_id_context.get(), "")

    async def test_health_fails_when_solver_unavailable(self) -> None:
        with patch.object(production_planner_app.production_planner_core, "linprog", None):
            status, headers, body = await self.call_app("GET", "/api/health")
        self.assertEqual(status, 503)
        self.assertFalse(json.loads(body)["solverReady"])
        self.assertIn("x-request-id", headers)

    def test_sentry_scrubs_request_and_stack_locals(self) -> None:
        event = {"request": {"data": "private"}, "user": {"id": "private"},
                 "exception": {"values": [{"stacktrace": {"frames": [{"vars": {"payload": "private"}, "lineno": 4}]}}]}}
        result = production_planner_app.scrub_sentry_event(event, {})
        self.assertNotIn("private", json.dumps(result))
        self.assertIn("lineno", json.dumps(result))

    async def test_deployed_monitoring_probe_requires_auth_and_preserves_environment(self):
        for environment in ("staging", "production"):
            production_planner_app.app.settings = replace(self.original_settings, sentry_environment=environment,
                sentry_dsn="https://public@example.invalid/1", monitoring_test_token="a" * 32)
            production_planner_app.app.last_monitoring_test = float("-inf")
            with patch.object(production_planner_app, "capture_exception") as capture, patch.object(production_planner_app.planner, "plan") as plan:
                status, _, _ = await self.call_app("POST", "/api/monitoring-test")
                self.assertEqual(status, 401)
                capture.assert_not_called()
                status, headers, body = await self.call_app("POST", "/api/monitoring-test", headers={"Authorization": "Bearer " + "a" * 32})
                self.assertEqual(status, 500)
                self.assertTrue(json.loads(body)["monitoringTest"])
                self.assertEqual(json.loads(body)["environment"], environment)
                self.assertIn("x-request-id", headers)
                capture.assert_called_once()
                self.assertIsInstance(capture.call_args.args[0], production_planner_app.MonitoringTestError)
                plan.assert_not_called()
                status, _, _ = await self.call_app("POST", "/api/monitoring-test", headers={"Authorization": "Bearer " + "a" * 32})
                self.assertEqual(status, 429)
                self.assertEqual(capture.call_count, 1)

    async def test_monitoring_probe_real_sdk_tags_without_network(self):
        import sentry_sdk
        from sentry_sdk.transport import Transport
        from sentry_sdk.integrations.logging import LoggingIntegration
        events = []
        class MemoryTransport(Transport):
            def capture_envelope(self, envelope):
                events.extend(item.get_event() for item in envelope.items if item.type == "event")
        test_settings = replace(self.original_settings, sentry_environment="production", sentry_dsn="https://public@example.invalid/1", monitoring_test_token="a"*32)
        production_planner_app.app.settings = test_settings
        with patch.object(production_planner_app, "settings", test_settings), sentry_sdk.init(
            dsn=test_settings.sentry_dsn, environment="production", release="probe-test",
            transport=MemoryTransport, before_send=production_planner_app.scrub_sentry_event,
            integrations=[LoggingIntegration(event_level=None)]):
            status, headers, _ = await self.call_app("POST", "/api/monitoring-test", headers={"Authorization":"Bearer " + "a"*32})
            sentry_sdk.flush()
        self.assertEqual(status,500)
        self.assertEqual(len(events),1)
        self.assertEqual(events[0]["tags"]["request_id"],headers["x-request-id"])
        self.assertEqual(events[0]["tags"]["monitoring_test"],"true")
        self.assertEqual(events[0]["environment"],"production")
        self.assertNotIn("Bearer",json.dumps(events))

    async def test_monitoring_probe_disabled_or_misconfigured(self):
        for environment, token, dsn, expected in [("development", "a"*32, "set", 404), ("production", "", "set", 404), ("production", "a"*32, "", 503)]:
            production_planner_app.app.settings = replace(self.original_settings, sentry_environment=environment, monitoring_test_token=token, sentry_dsn=dsn)
            with patch.object(production_planner_app, "capture_exception") as capture:
                status, _, _ = await self.call_app("POST", "/api/monitoring-test", headers={"Authorization":"Bearer " + "a"*32})
                self.assertEqual(status, expected)
                capture.assert_not_called()

    async def test_health_and_summary(self) -> None:
        status, headers, body = await self.call_app("GET", "/api/health")
        payload = json.loads(body)

        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertIn("planCache", payload)
        self.assertEqual(headers["cache-control"], "no-store, max-age=0")
        self.assertEqual(headers["x-content-type-options"], "nosniff")

        status, _headers, body = await self.call_app("GET", "/api/summary")
        payload = json.loads(body)

        self.assertEqual(status, 200)
        self.assertNotIn("excelPath", payload)
        self.assertNotIn("sourceDocsJson", payload)

    async def test_api_cors_headers_for_allowed_origin(self) -> None:
        production_planner_app.app.settings = replace(
            self.original_settings,
            allowed_origins=("https://planner.example",),
        )

        status, headers, body = await self.call_app(
            "OPTIONS",
            "/api/plan",
            headers={"Origin": "https://planner.example"},
        )

        self.assertEqual(status, 204)
        self.assertEqual(body, b"")
        self.assertEqual(headers["access-control-allow-origin"], "https://planner.example")
        self.assertEqual(headers["access-control-allow-methods"], "GET,POST,OPTIONS")
        self.assertIn("X-Request-ID", headers["access-control-expose-headers"])

        status, headers, _body = await self.call_app(
            "GET",
            "/api/health",
            headers={"Origin": "https://unlisted.example"},
        )

        self.assertEqual(status, 200)
        self.assertNotIn("access-control-allow-origin", headers)

    async def test_static_cache_and_sensitive_file_blocking(self) -> None:
        status, headers, _body = await self.call_app("HEAD", "/production_planner.js")

        self.assertEqual(status, 200)
        self.assertIn("max-age=604800", headers["cache-control"])
        self.assertEqual(headers["x-frame-options"], "DENY")

        for path in ["/production_planner_core.py", "/data/Data.xlsx", "/__pycache__/x.pyc"]:
            with self.subTest(path=path):
                status, _headers, _body = await self.call_app("GET", path)
                self.assertEqual(status, 404)

    async def test_plan_success(self) -> None:
        body = json.dumps({
            "targets": [{"itemClass": "Desc_IronPlate_C", "rate": 60}],
        }).encode("utf-8")

        status, headers, response_body = await self.call_app("POST", "/api/plan", body)
        payload = json.loads(response_body)

        self.assertEqual(status, 200)
        self.assertEqual(headers["content-type"], "application/json; charset=utf-8")
        self.assertEqual(payload["summary"]["targetCount"], 1)
        self.assertGreater(payload["summary"]["recipeRunCount"], 0)

    async def test_plan_cache_and_metrics(self) -> None:
        body = json.dumps({
            "targets": [{"itemClass": "Desc_IronPlate_C", "rate": 60}],
        }).encode("utf-8")

        status, headers, _response_body = await self.call_app("POST", "/api/plan", body)
        self.assertEqual(status, 200)
        self.assertEqual(headers["x-plan-cache"], "MISS")

        status, headers, response_body = await self.call_app("POST", "/api/plan", body)
        payload = json.loads(response_body)
        self.assertEqual(status, 200)
        self.assertEqual(headers["x-plan-cache"], "HIT")
        self.assertEqual(payload["summary"]["targetCount"], 1)

        status, _headers, response_body = await self.call_app("GET", "/api/metrics")
        metrics = json.loads(response_body)

        self.assertEqual(status, 200)
        self.assertTrue(metrics["ok"])
        self.assertGreaterEqual(metrics["metrics"]["plan"]["cacheHits"], 1)
        self.assertGreaterEqual(metrics["metrics"]["plan"]["cacheMisses"], 1)
        self.assertGreaterEqual(metrics["planCache"]["entries"], 1)

    async def test_plan_body_and_input_limits(self) -> None:
        status, _headers, body = await self.call_app("POST", "/api/plan", b"{" + b" " * 70_000 + b"}")
        self.assertEqual(status, 413)
        self.assertIn("too large", json.loads(body)["error"])

        too_many_targets = {
            "targets": [{"itemClass": "Desc_IronPlate_C", "rate": 1} for _ in range(13)],
        }
        status, _headers, body = await self.call_app(
            "POST",
            "/api/plan",
            json.dumps(too_many_targets).encode("utf-8"),
        )
        self.assertEqual(status, 400)
        self.assertIn("At most", json.loads(body)["error"])

        invalid_rate = {
            "targets": [{"itemClass": "Desc_IronPlate_C", "rate": float("inf")}],
        }
        status, _headers, body = await self.call_app(
            "POST",
            "/api/plan",
            json.dumps(invalid_rate).encode("utf-8"),
        )
        self.assertEqual(status, 400)
        self.assertIn("finite", json.loads(body)["error"])

    async def test_empty_recipe_selection_returns_expansion_response(self) -> None:
        body = json.dumps({
            "targets": [{"itemClass": "Desc_IronPlate_C", "rate": 60}],
            "enabledRecipeIds": [],
        }).encode("utf-8")

        status, _headers, response_body = await self.call_app("POST", "/api/plan", body)
        payload = json.loads(response_body)

        self.assertEqual(status, 200)
        self.assertTrue(payload["recipeExpansionRequired"])
        self.assertGreater(payload["summary"]["requiredRecipeCount"], 0)


if __name__ == "__main__":
    unittest.main()
