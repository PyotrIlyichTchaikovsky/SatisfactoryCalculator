from pathlib import Path
import sys
import unittest

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
