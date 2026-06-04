from __future__ import annotations

import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from production_planner_core import DEFAULT_EXCEL_PATH, PlannerError, ProductionPlanner


STATIC_DIR = Path(__file__).resolve().parent


class PlannerRequestHandler(SimpleHTTPRequestHandler):
    planner: ProductionPlanner

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/summary":
            self._send_json(self.planner.summary())
            return
        if path == "/api/items":
            self._send_json({"items": self.planner.list_items()})
            return
        if path == "/":
            self.path = "/production_planner.html"
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/plan":
            self._send_json({"error": "Unknown API endpoint."}, status=404)
            return

        try:
            payload = self._read_json_body()
            result = self.planner.plan(
                payload.get("targets", []),
                payload.get("selectedRecipes", {}),
            )
        except PlannerError as exc:
            self._send_json({"error": str(exc)}, status=400)
            return
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self._send_json({"error": f"Invalid JSON request body: {exc}"}, status=400)
            return
        except Exception as exc:  # pragma: no cover - keep the HTTP server alive on unexpected failures.
            self._send_json({"error": f"Server error: {exc}"}, status=500)
            return

        self._send_json(result)

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        payload = json.loads(raw.decode("utf-8")) if raw else {}
        if not isinstance(payload, dict):
            raise PlannerError("Request body must be a JSON object.")
        return payload

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the Satisfactory production planner.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind.")
    parser.add_argument("--port", type=int, default=8000, help="HTTP port to bind.")
    parser.add_argument(
        "--excel",
        type=Path,
        default=DEFAULT_EXCEL_PATH,
        help="Path to Satisfactory_Recipes_Wide.xlsx.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    planner = ProductionPlanner.from_excel(args.excel)
    PlannerRequestHandler.planner = planner
    handler_class = partial(PlannerRequestHandler, directory=str(STATIC_DIR))

    server = ThreadingHTTPServer((args.host, args.port), handler_class)
    print(f"Serving production planner at http://{args.host}:{args.port}/")
    print(f"Excel source: {planner.excel_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
