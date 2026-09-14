from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import build_frontend


class FrontendMonitoringBuildTests(unittest.TestCase):
    def test_sentry_dsn_origin_excludes_public_key_and_supports_regions(self):
        config = {"apiBaseUrl": "https://api.example", "sentryBrowserScriptUrl": "https://browser.sentry-cdn.com/sdk.js", "sentryDsn": "https://public-key@o123.ingest.de.sentry.io/456", "adsenseEnabled": False, "adsenseClient": ""}
        csp = build_frontend.content_security_policy(config)
        self.assertIn("https://o123.ingest.de.sentry.io", csp)
        self.assertNotIn("public-key", csp)
        self.assertIn("https://api.example", csp)

    def test_diagnostics_asset_precedes_planner(self):
        html = (build_frontend.SOURCE_DIR / "production_planner.html").read_text(encoding="utf-8")
        self.assertLess(html.index('src="planner_diagnostics.js'), html.index('src="production_planner.js'))


class ReleaseFrontendTests(unittest.TestCase):
    def test_production_csp_allows_cloudflare_web_analytics_beacon(self):
        base = {"apiBaseUrl": "https://api.example", "sentryBrowserScriptUrl": "", "sentryDsn": "", "adsenseEnabled": False, "adsenseClient": ""}
        production_csp = build_frontend.content_security_policy(dict(base, sentryEnvironment="production"))
        staging_csp = build_frontend.content_security_policy(dict(base, sentryEnvironment="staging"))
        self.assertIn("https://static.cloudflareinsights.com", production_csp)
        self.assertNotIn("https://static.cloudflareinsights.com", staging_csp)

    def test_staging_html_and_headers_are_labeled_and_not_indexed(self):
        with patch.dict(build_frontend.os.environ, {"SENTRY_ENVIRONMENT":"staging", "SENTRY_RELEASE":"a"*40, "RELEASE_VERSION":"v2026.09.14.42.1"}, clear=True):
            config=build_frontend.frontend_config()
        html=build_frontend.render_html(build_frontend.SOURCE_DIR/"production_planner.html",config,{})
        self.assertIn("Release test environment",html)
        self.assertIn("Version v2026.09.14.42.1",html)
        self.assertIn('name="robots" content="noindex, nofollow"',html)
        headers=build_frontend.render_headers(config)
        self.assertIn("X-Robots-Tag: noindex",headers)
        self.assertIn("/release.json",headers)

    def test_environment_config_changes_do_not_change_application_identity(self):
        with patch.dict(build_frontend.os.environ, {"SENTRY_ENVIRONMENT":"staging", "PLANNER_API_BASE_URL":"https://stage.example", "SENTRY_RELEASE":"a"*40, "RELEASE_VERSION":"v2026.09.14.42.1"}, clear=True):
            first=build_frontend.release_manifest(build_frontend.frontend_config())
        with patch.dict(build_frontend.os.environ, {"SENTRY_ENVIRONMENT":"production", "PLANNER_API_BASE_URL":"https://prod.example", "SENTRY_RELEASE":"a"*40, "RELEASE_VERSION":"v2026.09.14.42.1"}, clear=True):
            second=build_frontend.release_manifest(build_frontend.frontend_config())
        self.assertEqual(first["applicationDigest"],second["applicationDigest"])
        self.assertEqual(first["dataVersion"],second["dataVersion"])
        self.assertNotEqual(first["configDigest"],second["configDigest"])
