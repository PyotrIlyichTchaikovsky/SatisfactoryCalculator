"""Check a deployed planner without sending private plans or injecting faults."""
from __future__ import annotations
import argparse
import json
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="Planner API origin, e.g. https://your-service.a.run.app")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    for path, payload in [("/api/health", None), ("/api/plan", {"targets": [{"itemClass": "Desc_IronPlate_C", "rate": 60}]})]:
        data = json.dumps(payload).encode() if payload is not None else None
        request = Request(base + path, data=data, headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=30) as response:
            body = json.load(response)
            request_id = response.headers.get("X-Request-ID")
            if not request_id:
                raise SystemExit(f"FAIL {path}: missing request ID")
            if payload is None:
                valid = body.get("ok") and body.get("solverReady")
            else:
                valid = body.get("summary", {}).get("recipeRunCount", 0) > 0 and not body.get("recipeExpansionRequired")
            if not valid:
                raise SystemExit(f"FAIL {path}: invalid service result (request {request_id})")
            print(f"PASS {path} request_id={request_id} release={response.headers.get('X-Planner-Release')} data={response.headers.get('X-Planner-Data-Version')}")


if __name__ == "__main__":
    main()
