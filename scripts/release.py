"""Release transaction for Cloud Run + Cloudflare Pages (never used for pull requests)."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

import build_frontend

WORK = Path("release-work")


class ReleaseError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def run(args, extra_env=None, expose_failure=False):
    result = subprocess.run(args, capture_output=True, text=True, env={**os.environ, **(extra_env or {})})
    if result.returncode:
        # Do not dump provider output that could include secret environment values.
        detail = ""
        if expose_failure:
            output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
            for name in ("CLOUDFLARE_API_TOKEN", "SENTRY_DSN", "SENTRY_FRONTEND_DSN", "PLANNER_MONITORING_TEST_TOKEN"):
                secret = os.getenv(name, "")
                if secret:
                    output = output.replace(secret, "[redacted]")
            lines = output.splitlines()
            detail = "\n" + "\n".join(lines[-30:])[-4000:] if lines else ""
        raise ReleaseError(f"{args[0]} {args[1] if len(args)>1 else ''} failed (exit {result.returncode}).{detail or ' Check provider deployment logs.'}")
    return result.stdout.strip()


def get_json(url):
    headers = {
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "SatisfactoryCalculator-Release/1.0",
    }
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        return json.load(response)


def https_origin(value):
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password and parsed.path in ("", "/") and not parsed.query and not parsed.fragment


class Config:
    def __init__(self):
        names = ["DEPLOY_ENVIRONMENT", "GCP_PROJECT_ID", "GCP_REGION", "CLOUD_RUN_SERVICE",
                 "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_PAGES_PROJECT", "CLOUDFLARE_API_TOKEN",
                 "PUBLIC_SITE_URL", "PLANNER_API_BASE_URL", "SENTRY_DSN", "SENTRY_FRONTEND_DSN",
                 "SENTRY_BROWSER_SCRIPT_URL", "PLANNER_MONITORING_TEST_TOKEN"]
        self.values = {name: os.getenv(name, "").strip() for name in names}
        for name, value in self.values.items():
            require(bool(value), f"Missing environment configuration: {name}")
        self.environment = self.values["DEPLOY_ENVIRONMENT"]
        maximum = os.getenv("CLOUD_RUN_MAX_INSTANCES", "").strip()
        require(not maximum or (maximum.isdigit() and int(maximum) > 0), "CLOUD_RUN_MAX_INSTANCES must be a positive integer")
        require(self.environment in {"staging", "production"}, "Unsupported deployment environment")
        for name in ("PUBLIC_SITE_URL", "PLANNER_API_BASE_URL"):
            require(https_origin(self.values[name]), f"{name} must be an HTTPS origin")
            self.values[name] = self.values[name].rstrip("/")
        require(self.values["PUBLIC_SITE_URL"] != self.values["PLANNER_API_BASE_URL"], "Frontend and API origins must be separate")
        require(len(self.values["PLANNER_MONITORING_TEST_TOKEN"]) >= 32, "Monitoring test token must contain at least 32 characters")
        for name in ("GCP_PROJECT_ID", "GCP_REGION", "CLOUD_RUN_SERVICE", "CLOUDFLARE_PAGES_PROJECT", "CLOUDFLARE_ACCOUNT_ID"):
            require(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]*", self.values[name]), f"Invalid {name}")

    def __getitem__(self, name):
        return self.values[name]

    def identity(self):
        return {key: self[key] for key in ("GCP_PROJECT_ID", "GCP_REGION", "CLOUD_RUN_SERVICE", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_PAGES_PROJECT", "PUBLIC_SITE_URL", "PLANNER_API_BASE_URL")}


def validate_candidate(candidate, config):
    require(candidate.get("schema") == 1, "Unknown candidate schema")
    require(re.fullmatch(r"[0-9a-f]{40}", candidate.get("sha", "")), "Candidate requires a full commit SHA")
    require(re.fullmatch(r"[0-9]+-[0-9]+", candidate.get("releaseId", "")), "Invalid release ID")
    require(re.fullmatch(r"[a-z0-9.-]+-docker\.pkg\.dev/[a-zA-Z0-9_./-]+@sha256:[0-9a-f]{64}", candidate.get("image", "")), "Candidate requires an immutable Artifact Registry digest")
    require(candidate["sha"] == os.getenv("GITHUB_SHA", candidate["sha"]), "Checkout and candidate SHA differ")
    require(candidate["applicationDigest"] == build_frontend.application_digest(), "Application source differs from the tested candidate")
    if config.environment == "production":
        require(candidate.get("stagingPassed") is True, "Candidate did not pass staging tests")
        stage = candidate["stagingIdentity"]
        require(stage["PUBLIC_SITE_URL"] != config["PUBLIC_SITE_URL"] and stage["PLANNER_API_BASE_URL"] != config["PLANNER_API_BASE_URL"], "Staging and production origins must differ")
        require((stage["GCP_PROJECT_ID"], stage["GCP_REGION"], stage["CLOUD_RUN_SERVICE"]) != (config["GCP_PROJECT_ID"], config["GCP_REGION"], config["CLOUD_RUN_SERVICE"]), "Production cannot reuse staging's Cloud Run service")
        require((stage["CLOUDFLARE_ACCOUNT_ID"], stage["CLOUDFLARE_PAGES_PROJECT"]) != (config["CLOUDFLARE_ACCOUNT_ID"], config["CLOUDFLARE_PAGES_PROJECT"]), "Production cannot reuse staging's Pages project")


def verify_manifest(actual, expected, environment):
    for key in ("sha", "releaseId", "applicationDigest", "dataVersion"):
        require(actual.get(key) == expected.get(key), f"Deployed frontend {key} mismatch")
    require(actual.get("environment") == environment, "Deployed frontend environment mismatch")


class Cloud:
    def __init__(self, config):
        self.c = config
        self.gcloud = ["gcloud", "--project", config["GCP_PROJECT_ID"]]
        self.region = ["--region", config["GCP_REGION"]]

    def cf(self, suffix="", method="GET"):
        url = f"https://api.cloudflare.com/client/v4/accounts/{self.c['CLOUDFLARE_ACCOUNT_ID']}/pages/projects/{self.c['CLOUDFLARE_PAGES_PROJECT']}{suffix}"
        req = Request(url, method=method, headers={"Authorization": "Bearer " + self.c["CLOUDFLARE_API_TOKEN"], "Content-Type": "application/json"}, data=b"{}" if method == "POST" else None)
        with urlopen(req, timeout=60) as response:
            payload = json.load(response)
        require(payload.get("success"), "Cloudflare API rejected the operation")
        return payload["result"]

    def service(self):
        names = run(self.gcloud + ["run", "services", "list", *self.region, "--filter", "metadata.name=" + self.c["CLOUD_RUN_SERVICE"], "--format=value(metadata.name)"])
        if not names:
            return None
        return json.loads(run(self.gcloud + ["run", "services", "describe", self.c["CLOUD_RUN_SERVICE"], *self.region, "--format=json"]))

    def snapshot(self):
        project = self.cf()
        require(project.get("production_branch") == "main", "Both Pages projects must use main as production branch")
        source = project.get("source") or {}
        if source:
            require(source.get("config", {}).get("production_deployments_enabled") is False, "Disable Pages Git auto-production deployments before using this pipeline")
        service = self.service()
        status = service.get("status", {}) if service else {}
        traffic = {row["revisionName"]: row["percent"] for row in status.get("traffic", []) if row.get("percent") and row.get("revisionName")}
        require(not service or sum(traffic.values()) == 100, "Cannot snapshot unresolved Cloud Run traffic")
        canonical = project.get("canonical_deployment")
        deployment = canonical.get("id") if canonical else None
        manifest = None
        if deployment:
            try:
                manifest = get_json(self.c["PUBLIC_SITE_URL"] + "/release.json")
            except HTTPError as error:
                if error.code != 404:
                    raise
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass  # Legacy Pages SPA fallback returns HTML instead of a manifest.
            if not isinstance(manifest, dict) or manifest.get("schema") != 1:
                manifest = None
            if self.c.environment == "production" and manifest is None:
                require(os.getenv("ALLOW_UNMANAGED_BASELINE") == "true", "Existing production has no release manifest. Review migration instructions before opting into ALLOW_UNMANAGED_BASELINE.")
        return {"traffic": traffic, "frontendDeployment": deployment, "manifest": manifest}

    def stage_backend(self, image, sha, release_id, previous):
        revision = self.c["CLOUD_RUN_SERVICE"] + "-r" + release_id
        require(len(revision) <= 63, "Cloud Run service name is too long for release revisions")
        variables = {"PLANNER_ALLOWED_ORIGINS": self.c["PUBLIC_SITE_URL"], "PLANNER_LOG_LEVEL": "INFO",
                     "SENTRY_ENVIRONMENT": self.c.environment, "SENTRY_RELEASE": sha,
                     "SENTRY_DSN": self.c["SENTRY_DSN"], "PLANNER_MONITORING_TEST_TOKEN": self.c["PLANNER_MONITORING_TEST_TOKEN"]}
        # JSON is valid YAML; the secret-bearing file is outside uploaded artifacts.
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / "runtime.json"
            env_file.write_text(json.dumps(variables), encoding="utf-8")
            args = self.gcloud + ["run", "deploy", self.c["CLOUD_RUN_SERVICE"], *self.region,
                "--image", image, "--revision-suffix", "r" + release_id, "--tag", "candidate",
                "--port", "8080", "--cpu", "1", "--memory", "1Gi", "--concurrency", "8",
                "--min-instances", "0", "--max-instances", (os.getenv("CLOUD_RUN_MAX_INSTANCES") or ("1" if self.c.environment == "staging" else "3")),
                "--timeout", "60s", "--env-vars-file", str(env_file), "--allow-unauthenticated", "--quiet"]
            if previous["traffic"]:
                args.append("--no-traffic")
            run(args)
        status = self.service()["status"]
        require(status.get("latestReadyRevisionName") == revision, "New Cloud Run revision is not ready")
        tag = next((row["url"] for row in status.get("traffic", []) if row.get("tag") == "candidate" and row.get("revisionName") == revision), None)
        require(tag, "Missing tagged candidate URL")
        return revision, tag

    def set_traffic(self, traffic):
        require(traffic and sum(traffic.values()) == 100, "No complete backend version to restore")
        run(self.gcloud + ["run", "services", "update-traffic", self.c["CLOUD_RUN_SERVICE"], *self.region,
                          "--to-revisions", ",".join(f"{revision}={percent}" for revision, percent in traffic.items()), "--quiet"])

    def publish_frontend(self, sha):
        run(["node", "node_modules/wrangler/bin/wrangler.js", "pages", "deploy", "dist/frontend",
             "--project-name", self.c["CLOUDFLARE_PAGES_PROJECT"], "--branch", "main", "--commit-hash", sha, "--commit-dirty=true"])
        deployment = self.cf().get("canonical_deployment")
        require(deployment and deployment.get("deployment_trigger", {}).get("metadata", {}).get("commit_hash") == sha, "Cloudflare did not activate the requested frontend")
        return deployment["id"]

    def restore(self, snapshot):
        errors = []
        # Try both independent restores even when one provider fails.
        try:
            active = (self.cf().get("canonical_deployment") or {}).get("id")
            if active != snapshot.get("frontendDeployment"):
                if snapshot.get("frontendDeployment"):
                    self.cf("/deployments/" + quote(snapshot["frontendDeployment"], safe="") + "/rollback", "POST")
                else:
                    errors.append("frontend has no recoverable baseline")
        except Exception:
            errors.append("frontend restore failed")
        try:
            if snapshot.get("traffic"):
                self.set_traffic(snapshot["traffic"])
            else:
                service = self.service()
                status = service.get("status", {}) if service else {}
                active_traffic = {row["revisionName"]: row["percent"] for row in status.get("traffic", []) if row.get("percent") and row.get("revisionName")}
                if active_traffic:
                    errors.append("backend has no recoverable baseline")
        except Exception:
            errors.append("backend restore failed")
        require(not errors, "; ".join(errors))
        actual = self.snapshot()
        require(actual["traffic"] == snapshot["traffic"] and actual["frontendDeployment"] == snapshot["frontendDeployment"], "Provider state does not match recovery target")
        expected = snapshot.get("manifest")
        if snapshot.get("frontendDeployment"):
            check_live(self.c, expected, browser=True)
        elif snapshot.get("traffic"):
            check_api_until_ready(self.c["PLANNER_API_BASE_URL"], self.c.environment, legacy=True)


def check_api(base_url, environment, sha=None, data_version=None, legacy=False):
    health = get_json(base_url + "/api/health")
    require(health.get("ok") and health.get("solverReady", legacy), "API is not ready for calculations")
    if not legacy:
        require(health.get("environment") == environment, "API environment mismatch")
    if sha:
        require(health.get("release") == sha, "API release mismatch")
    if data_version:
        require(health.get("dataVersion") == data_version, "API game data mismatch")
    for targets in ([{"itemClass": "Desc_IronPlate_C", "rate": 60}], [{"itemClass": "Desc_RocketFuel_C", "rate": 60}], [{"itemClass": "Desc_IronPlate_C", "rate": 30}, {"itemClass": "Desc_IronRod_C", "rate": 30}]):
        req = Request(base_url + "/api/plan", data=json.dumps({"targets": targets}).encode(), headers={"Content-Type": "application/json"})
        with urlopen(req, timeout=45) as response:
            body = json.load(response)
            if not legacy:
                require(response.headers.get("X-Request-ID"), "Missing response correlation ID")
        require(len(body.get("targets", [])) == len(targets) and all(actual.get("item", {}).get("className") == target["itemClass"] and abs(actual.get("rate", 0) - target["rate"]) < 1e-6 for actual, target in zip(body["targets"], targets)), "Calculation target quantities mismatch")
        require(not body.get("recipeExpansionRequired") and body.get("summary", {}).get("targetCount") == len(targets) and body.get("summary", {}).get("recipeRunCount", 0) > 0, "Calculation smoke check failed")


def check_api_until_ready(base_url, environment, sha=None, data_version=None, legacy=False, attempts=5, delay=3):
    """Allow a newly-created Cloud Run tag time to become reachable."""
    for attempt in range(attempts):
        try:
            return check_api(base_url, environment, sha, data_version, legacy)
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(delay)


def check_live(config, expected, browser=True):
    # Only retry transient API/metadata propagation; a browser regression fails immediately.
    for attempt in range(20):
        try:
            check_api_until_ready(config["PLANNER_API_BASE_URL"], config.environment, expected.get("sha") if expected else None, expected.get("dataVersion") if expected else None, legacy=expected is None, attempts=1)
            if expected:
                verify_manifest(get_json(config["PUBLIC_SITE_URL"] + "/release.json"), expected, config.environment)
            break
        except Exception:
            if attempt == 19:
                raise
            time.sleep(3)
    if browser:
        run(["node", "node_modules/@playwright/test/cli.js", "test"], {
            "SITE_URL": config["PUBLIC_SITE_URL"], "API_URL": config["PLANNER_API_BASE_URL"],
            "EXPECTED_ENVIRONMENT": config.environment, "EXPECTED_SHA": expected.get("sha", "") if expected else "",
            "EXPECTED_RELEASE_ID": expected.get("releaseId", "") if expected else "", "LEGACY_BASELINE": "false" if expected else "true"},
            expose_failure=True)


def package_frontend(config, candidate):
    env = {"PLANNER_API_BASE_URL": config["PLANNER_API_BASE_URL"], "PUBLIC_SITE_URL": config["PUBLIC_SITE_URL"],
           "SENTRY_DSN": config["SENTRY_FRONTEND_DSN"], "SENTRY_BROWSER_SCRIPT_URL": config["SENTRY_BROWSER_SCRIPT_URL"],
           "SENTRY_ENVIRONMENT": config.environment, "SENTRY_RELEASE": candidate["sha"], "RELEASE_ID": candidate["releaseId"],
           "ADSENSE_ENABLED": os.getenv("ADSENSE_ENABLED") or "false", "ADSENSE_CLIENT": os.getenv("ADSENSE_CLIENT", ""), "FRONTEND_OUTPUT_DIR": str(Path("dist/frontend").resolve())}
    run([sys.executable, "scripts/build_frontend.py"], env)
    manifest = read_json("dist/frontend/release.json")
    verify_manifest(manifest, candidate, config.environment)
    return manifest


def prepare(config, cloud, candidate):
    validate_candidate(candidate, config)
    if config.environment == "production":
        stage = candidate["stagingIdentity"]
        verify_manifest(get_json(stage["PUBLIC_SITE_URL"] + "/release.json"), candidate, "staging")
        check_api(stage["PLANNER_API_BASE_URL"], "staging", candidate["sha"], candidate["dataVersion"])
    manifest = package_frontend(config, candidate)
    state = {"schema": 1, "environment": config.environment, "identity": config.identity(),
             "candidate": candidate, "manifest": manifest, "before": cloud.snapshot(), "status": "prepared"}
    write_json(WORK / "transaction.json", state)
    return state


def deploy(config, cloud, state):
    require(state["status"] == "prepared" and state["identity"] == config.identity(), "Invalid prepared deployment")
    require(cloud.snapshot() == state["before"], "Deployment changed since recovery snapshot; aborting")
    candidate = state["candidate"]
    try:
        state["status"] = "deploying"
        state["phase"] = "deploy_backend_candidate"
        write_json(WORK / "transaction.json", state)
        revision, tagged_url = cloud.stage_backend(candidate["image"], candidate["sha"], candidate["releaseId"], state["before"])
        state["phase"] = "verify_backend_candidate"
        write_json(WORK / "transaction.json", state)
        check_api_until_ready(tagged_url, config.environment, candidate["sha"], candidate["dataVersion"])
        state["phase"] = "activate_backend_candidate"
        write_json(WORK / "transaction.json", state)
        cloud.set_traffic({revision: 100})
        state["phase"] = "publish_frontend_candidate"
        write_json(WORK / "transaction.json", state)
        frontend = cloud.publish_frontend(candidate["sha"])
        state["phase"] = "verify_deployed_pair"
        write_json(WORK / "transaction.json", state)
        check_live(config, state["manifest"])
        state["after"] = {"traffic": {revision: 100}, "frontendDeployment": frontend, "manifest": state["manifest"]}
        state["status"] = "success"
        state["phase"] = "complete"
    except Exception as error:
        state["status"] = "failed"
        state["failure"] = str(error) if isinstance(error, ReleaseError) else type(error).__name__
        for folder in ("playwright-report", "test-results"):
            if Path(folder).exists():
                shutil.copytree(folder, WORK / "failed-browser" / folder, dirs_exist_ok=True)
        write_json(WORK / "transaction.json", state)
        try:
            cloud.restore(state["before"])
            state["status"] = "rolled_back"
        except Exception:
            state["status"] = "recovery_required"
        write_json(WORK / "transaction.json", state)
        raise ReleaseError(
            f"Deployment failed during {state.get('phase', 'unknown')}: {state['status']}. "
            f"Cause: {state['failure']} Recovery snapshot is preserved; inspect workflow artifacts and provider logs."
        ) from error
    write_json(WORK / "transaction.json", state)
    if config.environment == "staging":
        candidate.update(stagingPassed=True, stagingIdentity=config.identity())
        write_json(WORK / "candidate.json", candidate)
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(f"\n### {config.environment}: checks passed\n\nVersion `{candidate['sha']}` / release `{candidate['releaseId']}`\n\n[Open website]({config['PUBLIC_SITE_URL']})\n\n" + ("Manually test this exact version, then approve the production environment job. Reject/cancel this run if it needs fixes.\n" if config.environment == "staging" else "Production checks passed. Recovery artifacts contain the previous and current deployment pair.\n"))


def rollback(config, cloud, state, target):
    require(config.environment == "production" and state.get("environment") == "production" and state.get("schema") == 1, "Only production recovery records are accepted")
    require(state.get("identity") == config.identity(), "Recovery target belongs to another environment or service")
    if target == "after":
        require(state.get("status") == "success", "Selected release was not successfully validated")
    snapshot = state.get(target)
    require(snapshot and snapshot.get("frontendDeployment") and snapshot.get("traffic"), "No complete version pair exists for the requested recovery")
    write_json(WORK / "before-manual-rollback.json", cloud.snapshot())
    cloud.restore(snapshot)
    write_json(WORK / "rollback-result.json", {"status": "success", "restored": snapshot})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "candidate", "prepare", "deploy", "rollback"])
    parser.add_argument("--candidate", default="release-work/candidate.json")
    parser.add_argument("--state", default="release-work/transaction.json")
    parser.add_argument("--target", choices=["before", "after"], default="after")
    args = parser.parse_args()
    config = Config()
    cloud = Cloud(config)
    if args.command == "validate":
        return
    if args.command == "candidate":
        candidate = {"schema": 1, "sha": os.environ["GITHUB_SHA"], "releaseId": os.environ["RELEASE_ID"],
                     "image": os.environ["CANDIDATE_IMAGE"], "applicationDigest": build_frontend.application_digest(),
                     "dataVersion": hashlib.sha256((build_frontend.SOURCE_DIR / "data/Data.xlsx").read_bytes()).hexdigest()[:16]}
        validate_candidate(candidate, config)
        write_json(args.candidate, candidate)
    elif args.command == "prepare":
        prepare(config, cloud, read_json(args.candidate))
    elif args.command == "deploy":
        deploy(config, cloud, read_json(args.state))
    else:
        rollback(config, cloud, read_json(args.state), args.target)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"::error::{error if isinstance(error, ReleaseError) else type(error).__name__ + ': release operation failed'}", file=sys.stderr)
        sys.exit(1)
