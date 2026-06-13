from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from typing import Any


RECIPE_WEB_DIR = Path(__file__).resolve().parents[1] / "recipe_web"
sys.path.insert(0, str(RECIPE_WEB_DIR))

import production_planner_app  # noqa: E402


class ProductionPlannerAppTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        production_planner_app.plan_cache._entries.clear()

    async def call_app(self, method: str, path: str, body: bytes = b"") -> tuple[int, dict[str, str], bytes]:
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
            {"type": "http", "method": method, "path": path, "headers": []},
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
