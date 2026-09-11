"""Trigger the deployed backend monitoring probe; this sends a real test error."""
from __future__ import annotations
import argparse
import json
import os
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the bearer token to another URL.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url", help="Actual staging or production API origin (HTTPS)")
    parser.add_argument("--environment", choices=["staging", "production"], required=True)
    args = parser.parse_args()
    url = urlparse(args.base_url)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
        parser.error("Provide an HTTPS API origin without a path, credentials, query or fragment.")
    token = os.getenv("PLANNER_MONITORING_TEST_TOKEN", "").strip()
    if len(token) < 32:
        parser.error("Set PLANNER_MONITORING_TEST_TOKEN to this environment's test token (at least 32 characters).")
    opener = build_opener(NoRedirect())
    # Check the actual deployment identity before deliberately creating an error.
    with opener.open(args.base_url.rstrip("/") + "/api/health", timeout=30) as response:
        health = json.load(response)
    if health.get("environment") != args.environment:
        raise SystemExit("FAIL: deployed environment does not match --environment; no test error was requested.")
    request = Request(args.base_url.rstrip("/") + "/api/monitoring-test", data=b"{}",
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        response = opener.open(request, timeout=30)
    except HTTPError as exc:
        response = exc
    with response:
        body = json.load(response)
        request_id = response.headers.get("X-Request-ID")
        if response.code != 500 or body.get("monitoringTest") is not True or not request_id or body.get("environment") != args.environment:
            raise SystemExit(f"FAIL: HTTP {response.code}; {body.get('error', 'unexpected response')}")
        print(json.dumps({"result": "TEST_ERROR_TRIGGERED", "environment": body["environment"],
                          "request_id": request_id, "release": response.headers.get("X-Planner-Release"),
                          "next": "Verify this request_id in the deployed backend Sentry project, Cloud Logging and your alert notification."}, indent=2))


if __name__ == "__main__":
    main()
