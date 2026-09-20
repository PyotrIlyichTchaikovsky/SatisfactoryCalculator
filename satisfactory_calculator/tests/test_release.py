from __future__ import annotations
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"scripts"))
import release


class ReleaseTransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = Path(self.temp.name)
        self.work_patch = patch.object(release,"WORK",self.work)
        self.work_patch.start()
        self.env = {"DEPLOY_ENVIRONMENT":"production", "GCP_PROJECT_ID":"project", "GCP_REGION":"asia-east1",
            "CLOUD_RUN_SERVICE":"planner-prod", "CLOUDFLARE_ACCOUNT_ID":"account", "CLOUDFLARE_PAGES_PROJECT":"planner-prod",
            "CLOUDFLARE_API_TOKEN":"secret-value", "PUBLIC_SITE_URL":"https://prod.example", "PLANNER_API_BASE_URL":"https://api.example", "PLANNER_ANALYTICS_ENDPOINT":"https://analytics.example/events",
            "SENTRY_DSN":"https://public@example.invalid/1", "SENTRY_FRONTEND_DSN":"https://public@example.invalid/2",
            "SENTRY_BROWSER_SCRIPT_URL":"https://cdn.example/sdk.js", "PLANNER_MONITORING_TEST_TOKEN":"x"*32}
        self.env_patch = patch.dict(os.environ,self.env,clear=True)
        self.env_patch.start()
        self.config = release.Config()
        self.stage = dict(self.config.identity(),CLOUD_RUN_SERVICE="planner-stage",CLOUDFLARE_PAGES_PROJECT="planner-stage",PUBLIC_SITE_URL="https://stage.example",PLANNER_API_BASE_URL="https://stage-api.example",PLANNER_ANALYTICS_ENDPOINT="https://stage-analytics.example/events")
        self.candidate = {"schema":1,"sha":"a"*40,"releaseId":"123-1","image":"asia-east1-docker.pkg.dev/project/images/planner@sha256:"+"b"*64,
                          "version":"v2026.09.14.42.1","applicationDigest":"c"*64,"dataVersion":"d"*16,
                          "localizationVersion":"e"*16,
                          "stagingPassed":True,"stagingIdentity":self.stage}
        self.old = {"traffic":{"old-revision":100},"frontendDeployment":"old-pages","manifest":None}
        self.state = {"schema":1,"environment":"production","identity":self.config.identity(),"before":self.old,
                      "candidate":self.candidate,"manifest":dict(self.candidate,environment="production"),"status":"prepared"}

    def tearDown(self):
        self.env_patch.stop()
        self.work_patch.stop()
        self.temp.cleanup()

    def cloud(self):
        cloud=Mock()
        cloud.snapshot.return_value=copy.deepcopy(self.old)
        cloud.stage_backend.return_value=("new-revision","https://candidate.example")
        cloud.publish_frontend.return_value="new-pages"
        return cloud

    def test_release_version_uses_china_date_and_commit(self):
        instant = datetime(2026, 9, 13, 17, 30, tzinfo=timezone.utc)
        self.assertEqual(release.build_release_version("42", "1", instant), "v2026.09.14.42.1")

    def test_production_rejects_mutable_image_and_environment_reuse(self):
        with patch.object(release.build_frontend,"application_digest",return_value="c"*64):
            release.validate_candidate(self.candidate,self.config)
            for bad in (dict(self.candidate,image="registry/image:latest"),dict(self.candidate,stagingPassed=False),dict(self.candidate,stagingIdentity=self.config.identity())):
                with self.assertRaises(release.ReleaseError):
                    release.validate_candidate(bad,self.config)

    def test_stale_staging_candidate_never_touches_production(self):
        cloud=self.cloud()
        with patch.object(release.build_frontend,"application_digest",return_value="c"*64), patch.object(release,"get_json",return_value=dict(self.candidate,sha="f"*40,environment="staging")):
            with self.assertRaises(release.ReleaseError): release.prepare(self.config,cloud,self.candidate)
        cloud.snapshot.assert_not_called()
        cloud.stage_backend.assert_not_called()

    def test_manifest_rejects_a_different_localization_bundle(self):
        actual = dict(self.candidate, environment="production", localizationVersion="f"*16)
        with self.assertRaisesRegex(release.ReleaseError, "localizationVersion mismatch"):
            release.verify_manifest(actual, self.candidate, "production")

    def test_provider_drift_aborts_before_any_mutation(self):
        cloud=self.cloud(); cloud.snapshot.return_value=dict(self.old,frontendDeployment="outside-deploy")
        with self.assertRaises(release.ReleaseError): release.deploy(self.config,cloud,self.state)
        cloud.stage_backend.assert_not_called(); cloud.restore.assert_not_called()

    def test_recovery_snapshot_exists_before_first_mutation(self):
        cloud=self.cloud()
        def stage(*args):
            saved=release.read_json(self.work/"transaction.json")
            self.assertEqual(saved["before"],self.old)
            self.assertEqual(saved["status"],"deploying")
            return "new-revision","https://candidate.example"
        cloud.stage_backend.side_effect=stage
        with patch.object(release,"check_api"),patch.object(release,"check_live"):
            release.deploy(self.config,cloud,self.state)
        saved=release.read_json(self.work/"transaction.json")
        self.assertEqual(saved["status"],"success")
        self.assertEqual(saved["after"]["traffic"],{"new-revision":100})
        self.assertNotIn("secret-value",json.dumps(saved))

    def test_post_deploy_failure_restores_pair_and_remains_a_failed_release(self):
        cloud=self.cloud()
        with patch.object(release,"check_api"),patch.object(release,"check_live",side_effect=release.ReleaseError("page regression")):
            with self.assertRaisesRegex(release.ReleaseError,"rolled_back.*page regression"):
                release.deploy(self.config,cloud,self.state)
        cloud.restore.assert_called_once_with(self.old)
        self.assertEqual(release.read_json(self.work/"transaction.json")["status"],"rolled_back")

    def test_failed_first_release_never_claims_successful_rollback(self):
        cloud=self.cloud(); empty={"traffic":{},"frontendDeployment":None,"manifest":None}
        self.state["before"]=empty; cloud.snapshot.return_value=empty
        cloud.stage_backend.side_effect=release.ReleaseError("build not ready")
        cloud.restore.side_effect=release.ReleaseError("no previous version")
        with self.assertRaisesRegex(release.ReleaseError,"recovery_required"):
            release.deploy(self.config,cloud,self.state)

    def test_candidate_api_check_retries_transient_tag_propagation(self):
        with patch.object(release,"check_api",side_effect=[OSError("not propagated"),None]) as check, patch.object(release.time,"sleep") as sleep:
            release.check_api_until_ready("https://candidate.example","staging",attempts=3,delay=2)
        self.assertEqual(check.call_count,2)
        sleep.assert_called_once_with(2)

    def test_restore_accepts_missing_frontend_when_no_frontend_was_changed(self):
        cloud=release.Cloud(self.config)
        backend={"metadata":{"name":"planner-prod"},"status":{"traffic":[{"revisionName":"old-revision","percent":100}]}}
        with patch.object(cloud,"cf",return_value={"canonical_deployment":None,"production_branch":"main"}), patch.object(cloud,"service",return_value=backend), patch.object(cloud,"set_traffic") as traffic, patch.object(release,"check_api_until_ready") as check:
            cloud.restore({"traffic":{"old-revision":100},"frontendDeployment":None,"manifest":None})
        traffic.assert_called_once_with({"old-revision":100})
        check.assert_called_once_with("https://api.example","production",legacy=True)

    def test_failed_deploy_records_safe_failure_phase(self):
        cloud=self.cloud(); cloud.stage_backend.side_effect=release.ReleaseError("provider failed")
        with self.assertRaisesRegex(release.ReleaseError,"deploy_backend_candidate"):
            release.deploy(self.config,cloud,self.state)
        saved=release.read_json(self.work/"transaction.json")
        self.assertEqual(saved["phase"],"deploy_backend_candidate")

    def test_restore_attempts_backend_even_if_frontend_provider_fails(self):
        cloud=release.Cloud(self.config)
        with patch.object(cloud,"cf",side_effect=release.ReleaseError("provider down")),patch.object(cloud,"set_traffic") as traffic:
            with self.assertRaises(release.ReleaseError): cloud.restore(self.old)
        traffic.assert_called_once_with(self.old["traffic"])

    def test_manual_rollback_rejects_failed_or_foreign_target(self):
        cloud=self.cloud()
        for bad in (dict(self.state,status="failed",after=self.old),dict(self.state,status="success",after=self.old,identity=self.stage)):
            with self.assertRaises(release.ReleaseError): release.rollback(self.config,cloud,bad,"after")
        cloud.restore.assert_not_called()

    def test_checks_detect_wrong_environment_and_target_quantities(self):
        with patch.object(release,"get_json",return_value={"ok":True,"solverReady":True,"environment":"staging"}):
            with self.assertRaisesRegex(release.ReleaseError,"environment mismatch"):
                release.check_api("https://api.example","production")

    def test_public_json_requests_identify_the_release_client(self):
        response=Mock()
        response.__enter__=Mock(return_value=response)
        response.__exit__=Mock(return_value=False)
        response.read.return_value=b'{"ok": true}'
        with patch.object(release,"urlopen",return_value=response) as open_url:
            self.assertEqual(release.get_json("https://stage.example/release.json"),{"ok":True})
        request=open_url.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"),"SatisfactoryCalculator-Release/1.0")
        self.assertEqual(request.get_header("Accept"),"application/json")

    def test_browser_failure_summary_is_visible_and_secrets_are_redacted(self):
        result=Mock(returncode=1,stdout="1 failed\nexpected page title",stderr="token-value")
        with patch.object(release.subprocess,"run",return_value=result), patch.dict(os.environ,{"CLOUDFLARE_API_TOKEN":"token-value"}):
            with self.assertRaises(release.ReleaseError) as raised:
                release.run(["node","playwright"],expose_failure=True)
        message=str(raised.exception)
        self.assertIn("expected page title",message)
        self.assertIn("[redacted]",message)
        self.assertNotIn("token-value",message)

    def test_https_configuration_validation(self):
        for invalid in ("http://api.example","https://user:secret@api.example","https://api.example/path","https://api.example?token=secret"):
            with patch.dict(os.environ,PLANNER_API_BASE_URL=invalid):
                with self.assertRaises(release.ReleaseError): release.Config()
        for invalid in ("http://analytics.example/events", "https://analytics.example/", "https://analytics.example/events?token=secret"):
            with patch.dict(os.environ,PLANNER_ANALYTICS_ENDPOINT=invalid):
                with self.assertRaises(release.ReleaseError): release.Config()
