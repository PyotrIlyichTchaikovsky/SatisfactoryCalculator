from __future__ import annotations

import asyncio
import copy
import json
import logging
import mimetypes
import os
import time
from collections import OrderedDict
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from production_planner_core import DEFAULT_EXCEL_PATH, PlannerError, ProductionPlanner


STATIC_DIR = Path(__file__).resolve().parent
DEFAULT_MAX_BODY_BYTES = 64 * 1024
DEFAULT_PLAN_TIMEOUT_SECONDS = 15.0
DEFAULT_PLAN_QUEUE_TIMEOUT_SECONDS = 0.25
DEFAULT_MAX_CONCURRENT_PLANS = 2
DEFAULT_PLAN_CACHE_TTL_SECONDS = 900.0
DEFAULT_PLAN_CACHE_MAX_ENTRIES = 256

JsonDict = dict[str, Any]
Scope = dict[str, Any]
Receive = Any
Send = Any


@dataclass(frozen=True)
class PlannerAppSettings:
    excel_path: Path
    max_body_bytes: int
    plan_timeout_seconds: float
    plan_queue_timeout_seconds: float
    max_concurrent_plans: int
    plan_cache_ttl_seconds: float
    plan_cache_max_entries: int

    @classmethod
    def from_env(cls) -> "PlannerAppSettings":
        return cls(
            excel_path=Path(os.getenv("PLANNER_EXCEL_PATH", str(DEFAULT_EXCEL_PATH))).expanduser().resolve(),
            max_body_bytes=_env_int("PLANNER_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES, minimum=1024),
            plan_timeout_seconds=_env_float("PLANNER_PLAN_TIMEOUT_SECONDS", DEFAULT_PLAN_TIMEOUT_SECONDS, minimum=1.0),
            plan_queue_timeout_seconds=_env_float(
                "PLANNER_PLAN_QUEUE_TIMEOUT_SECONDS",
                DEFAULT_PLAN_QUEUE_TIMEOUT_SECONDS,
                minimum=0.0,
            ),
            max_concurrent_plans=_env_int(
                "PLANNER_MAX_CONCURRENT_PLANS",
                DEFAULT_MAX_CONCURRENT_PLANS,
                minimum=1,
            ),
            plan_cache_ttl_seconds=_env_float(
                "PLANNER_PLAN_CACHE_TTL_SECONDS",
                DEFAULT_PLAN_CACHE_TTL_SECONDS,
                minimum=0.0,
            ),
            plan_cache_max_entries=_env_int(
                "PLANNER_PLAN_CACHE_MAX_ENTRIES",
                DEFAULT_PLAN_CACHE_MAX_ENTRIES,
                minimum=0,
            ),
        )


class RequestError(ValueError):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


logger = logging.getLogger("production_planner")


class PlanCache:
    def __init__(self, ttl_seconds: float, max_entries: int) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._entries: OrderedDict[str, tuple[float, JsonDict]] = OrderedDict()

    def get(self, key: str) -> JsonDict | None:
        if self.ttl_seconds <= 0 or self.max_entries <= 0:
            return None
        entry = self._entries.get(key)
        if entry is None:
            return None
        expires_at, payload = entry
        if expires_at <= time.time():
            self._entries.pop(key, None)
            return None
        self._entries.move_to_end(key)
        return copy.deepcopy(payload)

    def set(self, key: str, payload: JsonDict) -> None:
        if self.ttl_seconds <= 0 or self.max_entries <= 0:
            return
        self._entries[key] = (time.time() + self.ttl_seconds, copy.deepcopy(payload))
        self._entries.move_to_end(key)
        while len(self._entries) > self.max_entries:
            self._entries.popitem(last=False)

    def snapshot(self) -> JsonDict:
        now = time.time()
        expired = [key for key, (expires_at, _payload) in self._entries.items() if expires_at <= now]
        for key in expired:
            self._entries.pop(key, None)
        return {
            "enabled": self.ttl_seconds > 0 and self.max_entries > 0,
            "entries": len(self._entries),
            "maxEntries": self.max_entries,
            "ttlSeconds": self.ttl_seconds,
        }


class PlannerMetrics:
    def __init__(self) -> None:
        self.request_count = 0
        self.api_request_count = 0
        self.plan_request_count = 0
        self.plan_success_count = 0
        self.plan_error_count = 0
        self.plan_timeout_count = 0
        self.plan_busy_count = 0
        self.plan_cache_hit_count = 0
        self.plan_cache_miss_count = 0
        self.plan_duration_ms_total = 0.0
        self.plan_duration_ms_max = 0.0
        self.last_plan_duration_ms = 0.0

    def record_request(self, path: str) -> None:
        self.request_count += 1
        if path.startswith("/api/"):
            self.api_request_count += 1

    def record_plan_success(self, duration_ms: float, cache_hit: bool = False) -> None:
        self.plan_request_count += 1
        self.plan_success_count += 1
        if cache_hit:
            self.plan_cache_hit_count += 1
        else:
            self.plan_cache_miss_count += 1
        self._record_duration(duration_ms)

    def record_plan_error(self, duration_ms: float) -> None:
        self.plan_request_count += 1
        self.plan_error_count += 1
        self._record_duration(duration_ms)

    def record_plan_timeout(self, duration_ms: float) -> None:
        self.plan_request_count += 1
        self.plan_timeout_count += 1
        self.plan_error_count += 1
        self._record_duration(duration_ms)

    def record_plan_busy(self) -> None:
        self.plan_request_count += 1
        self.plan_busy_count += 1
        self.plan_error_count += 1

    def _record_duration(self, duration_ms: float) -> None:
        self.plan_duration_ms_total += duration_ms
        self.plan_duration_ms_max = max(self.plan_duration_ms_max, duration_ms)
        self.last_plan_duration_ms = duration_ms

    def snapshot(self) -> JsonDict:
        average_ms = self.plan_duration_ms_total / self.plan_request_count if self.plan_request_count else 0.0
        return {
            "requests": {
                "total": self.request_count,
                "api": self.api_request_count,
            },
            "plan": {
                "total": self.plan_request_count,
                "success": self.plan_success_count,
                "errors": self.plan_error_count,
                "timeouts": self.plan_timeout_count,
                "busy": self.plan_busy_count,
                "cacheHits": self.plan_cache_hit_count,
                "cacheMisses": self.plan_cache_miss_count,
                "durationMsAvg": round(average_ms, 3),
                "durationMsMax": round(self.plan_duration_ms_max, 3),
                "durationMsLast": round(self.last_plan_duration_ms, 3),
            },
        }


class ProductionPlannerApp:
    def __init__(
        self,
        planner_instance: ProductionPlanner,
        app_settings: PlannerAppSettings,
        cache: PlanCache,
        metrics: PlannerMetrics,
    ) -> None:
        self.planner = planner_instance
        self.settings = app_settings
        self.cache = cache
        self.metrics = metrics

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            return

        method = str(scope.get("method") or "GET").upper()
        path = unquote(str(scope.get("path") or "/"))
        started_at = time.perf_counter()
        status = 500
        self.metrics.record_request(path)
        try:
            if path.startswith("/api/"):
                status = await self._handle_api(method, path, receive, send)
            else:
                status = await self._handle_static(method, path, send)
        except RequestError as exc:
            status = exc.status
            await send_json(send, {"error": str(exc)}, status=status)
        except PlannerError as exc:
            status = 400
            await send_json(send, {"error": str(exc)}, status=status)
        except Exception:
            logger.exception("Unexpected request failure method=%s path=%s", method, path)
            status = 500
            await send_json(send, {"error": "Server error. Please try again later."}, status=status)
        finally:
            duration_ms = (time.perf_counter() - started_at) * 1000
            if path.startswith("/api/"):
                logger.info("request method=%s path=%s status=%s duration_ms=%.1f", method, path, status, duration_ms)

    async def _handle_api(self, method: str, path: str, receive: Receive, send: Send) -> int:
        if method == "GET" and path == "/api/health":
            await send_json(
                send,
                {
                    "ok": True,
                    "uptimeSeconds": round(time.time() - app_started_at, 3),
                    "recipeCount": len(self.planner.recipes),
                    "itemCount": len(self.planner.items),
                    "maxConcurrentPlans": self.settings.max_concurrent_plans,
                    "planCache": self.cache.snapshot(),
                },
            )
            return 200
        if method == "GET" and path == "/api/metrics":
            await send_json(
                send,
                {
                    "ok": True,
                    "uptimeSeconds": round(time.time() - app_started_at, 3),
                    "metrics": self.metrics.snapshot(),
                    "planCache": self.cache.snapshot(),
                },
            )
            return 200
        if method == "GET" and path == "/api/summary":
            await send_json(send, self.planner.summary())
            return 200
        if method == "GET" and path in {"/api/items", "/api/materials"}:
            await send_json(send, {"items": self.planner.list_items()})
            return 200
        if method == "GET" and path == "/api/recipes":
            await send_json(send, self.planner.list_recipes())
            return 200
        if method == "POST" and path == "/api/plan":
            return await self._handle_plan(receive, send)
        await send_json(send, {"error": "Unknown API endpoint."}, status=404)
        return 404

    async def _handle_plan(self, receive: Receive, send: Send) -> int:
        body = await read_request_body(receive, self.settings.max_body_bytes)
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise RequestError(f"Invalid JSON request body: {exc}", status=400) from exc
        if not isinstance(payload, dict):
            raise RequestError("Request body must be a JSON object.", status=400)

        cache_key = plan_cache_key(payload)
        cached_result = self.cache.get(cache_key)
        if cached_result is not None:
            self.metrics.record_plan_success(0.0, cache_hit=True)
            await send_json(send, cached_result, headers={"X-Plan-Cache": "HIT"})
            return 200

        try:
            await asyncio.wait_for(plan_semaphore.acquire(), timeout=self.settings.plan_queue_timeout_seconds)
        except asyncio.TimeoutError:
            self.metrics.record_plan_busy()
            await send_json(
                send,
                {"error": "Planner is busy. Please retry in a few seconds."},
                status=503,
                headers={"Retry-After": "3"},
            )
            return 503

        started_at = time.perf_counter()
        worker = asyncio.create_task(
            asyncio.to_thread(
                self.planner.plan,
                payload.get("targets", []),
                enabled_recipe_ids=payload.get("enabledRecipeIds"),
            )
        )
        try:
            result = await asyncio.wait_for(asyncio.shield(worker), timeout=self.settings.plan_timeout_seconds)
        except asyncio.TimeoutError:
            worker.add_done_callback(_release_plan_slot_when_done)
            logger.warning("plan timeout after %.1fs", self.settings.plan_timeout_seconds)
            duration_ms = (time.perf_counter() - started_at) * 1000
            self.metrics.record_plan_timeout(duration_ms)
            await send_json(
                send,
                {"error": "Calculation timed out. Try fewer targets or a smaller production rate."},
                status=503,
                headers={"Retry-After": "5"},
            )
            return 503
        except Exception:
            plan_semaphore.release()
            duration_ms = (time.perf_counter() - started_at) * 1000
            self.metrics.record_plan_error(duration_ms)
            raise

        plan_semaphore.release()
        duration_ms = (time.perf_counter() - started_at) * 1000
        self.cache.set(cache_key, result)
        self.metrics.record_plan_success(duration_ms, cache_hit=False)
        logger.info(
            "plan success targets=%s selected_recipes=%s duration_ms=%.1f",
            len(payload.get("targets", []) if isinstance(payload.get("targets"), list) else []),
            len(payload.get("enabledRecipeIds", []) if isinstance(payload.get("enabledRecipeIds"), list) else []),
            duration_ms,
        )
        await send_json(send, result, headers={"X-Plan-Cache": "MISS"})
        return 200

    async def _handle_static(self, method: str, path: str, send: Send) -> int:
        if method not in {"GET", "HEAD"}:
            await send_json(send, {"error": "Method not allowed."}, status=405)
            return 405
        file_path = static_file_path(path)
        if file_path is None or not file_path.is_file():
            await send_plain(send, b"Not found", status=404, content_type="text/plain; charset=utf-8")
            return 404
        body = b"" if method == "HEAD" else file_path.read_bytes()
        await send_plain(
            send,
            body,
            status=200,
            content_type=mimetypes.guess_type(file_path.name)[0] or "application/octet-stream",
            cache_control=cache_control_for_static(file_path),
        )
        return 200


async def read_request_body(receive: Receive, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        event = await receive()
        event_type = event.get("type")
        if event_type == "http.disconnect":
            raise RequestError("Client disconnected.", status=499)
        if event_type != "http.request":
            continue
        chunk = event.get("body", b"")
        total += len(chunk)
        if total > max_bytes:
            raise RequestError("Request body is too large.", status=413)
        if chunk:
            chunks.append(chunk)
        if not event.get("more_body", False):
            break
    return b"".join(chunks)


async def send_json(send: Send, payload: JsonDict, status: int = 200, headers: dict[str, str] | None = None) -> None:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    await send_response(
        send,
        encoded,
        status=status,
        content_type="application/json; charset=utf-8",
        cache_control="no-store, max-age=0",
        headers=headers,
    )


async def send_plain(
    send: Send,
    body: bytes,
    status: int,
    content_type: str,
    cache_control: str | None = None,
) -> None:
    await send_response(
        send,
        body,
        status=status,
        content_type=content_type,
        cache_control=cache_control or "no-store, max-age=0",
    )


async def send_response(
    send: Send,
    body: bytes,
    status: int,
    content_type: str,
    cache_control: str,
    headers: dict[str, str] | None = None,
) -> None:
    response_headers = {
        "Content-Type": content_type,
        "Content-Length": str(len(body)),
        "Cache-Control": cache_control,
        **security_headers(),
        **(headers or {}),
    }
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(name.encode("latin-1"), value.encode("latin-1")) for name, value in response_headers.items()],
        }
    )
    await send({"type": "http.response.body", "body": body})


def static_file_path(path: str) -> Path | None:
    if path in {"", "/"}:
        return STATIC_DIR / "production_planner.html"
    allowed_root_files = {
        "/production_planner.html",
        "/production_planner.css",
        "/production_planner.js",
    }
    if path in allowed_root_files:
        return (STATIC_DIR / path.lstrip("/")).resolve()
    if path.startswith("/data/icons/") and ".." not in path:
        candidate = (STATIC_DIR / path.lstrip("/")).resolve()
        try:
            candidate.relative_to(STATIC_DIR)
        except ValueError:
            return None
        return candidate
    return None


def cache_control_for_static(file_path: Path) -> str:
    if file_path.name == "production_planner.html":
        return "no-cache, max-age=0"
    if file_path.suffix.lower() in {".css", ".js"}:
        return "public, max-age=604800"
    if "/data/icons/" in file_path.as_posix():
        return "public, max-age=2592000"
    return "public, max-age=3600"


def plan_cache_key(payload: JsonDict) -> str:
    targets = payload.get("targets", [])
    enabled_recipe_ids = payload.get("enabledRecipeIds")
    normalized_targets = []
    if isinstance(targets, list):
        for target in targets:
            if not isinstance(target, dict):
                normalized_targets.append(target)
                continue
            normalized_targets.append(
                {
                    "itemClass": str(target.get("itemClass") or "").strip(),
                    "itemName": str(target.get("itemName") or target.get("name") or "").strip(),
                    "rate": target.get("rate"),
                }
            )
    else:
        normalized_targets = targets
    normalized_enabled_recipe_ids = enabled_recipe_ids
    if isinstance(enabled_recipe_ids, list):
        normalized_enabled_recipe_ids = sorted(str(value or "").strip() for value in enabled_recipe_ids)
    return json.dumps(
        {
            "targets": normalized_targets,
            "enabledRecipeIds": normalized_enabled_recipe_ids,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def security_headers() -> dict[str, str]:
    return {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        ),
    }


def _release_plan_slot_when_done(task: asyncio.Task[Any]) -> None:
    try:
        task.exception()
    except asyncio.CancelledError:
        pass
    finally:
        plan_semaphore.release()


def _env_int(name: str, default: int, minimum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(minimum, value)


def _env_float(name: str, default: float, minimum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(minimum, value)


def configure_logging() -> None:
    level_name = os.getenv("PLANNER_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log_file = os.getenv("PLANNER_LOG_FILE", "").strip()
    if log_file:
        Path(log_file).expanduser().parent.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(log_file, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        handler.setLevel(level)
        logger.addHandler(handler)


configure_logging()
settings = PlannerAppSettings.from_env()
planner = ProductionPlanner.from_excel(settings.excel_path)
plan_semaphore = asyncio.Semaphore(settings.max_concurrent_plans)
plan_cache = PlanCache(settings.plan_cache_ttl_seconds, settings.plan_cache_max_entries)
planner_metrics = PlannerMetrics()
app_started_at = time.time()
logger.info(
    "planner app loaded excel=%s recipes=%s items=%s max_concurrent_plans=%s cache_ttl=%s cache_max_entries=%s",
    settings.excel_path,
    len(planner.recipes),
    len(planner.items),
    settings.max_concurrent_plans,
    settings.plan_cache_ttl_seconds,
    settings.plan_cache_max_entries,
)

app = ProductionPlannerApp(planner, settings, plan_cache, planner_metrics)
