from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import json
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import build_frontend
import generate_localizations


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

    def test_material_picker_asset_precedes_planner(self):
        html = (build_frontend.SOURCE_DIR / "production_planner.html").read_text(encoding="utf-8")
        self.assertLess(html.index('src="material_picker.js'), html.index('src="production_planner.js'))

    def test_localization_loads_before_planner(self):
        html = (build_frontend.SOURCE_DIR / "production_planner.html").read_text(encoding="utf-8")
        self.assertLess(html.index('src="planner_i18n.js'), html.index('src="production_planner.js'))

    def test_analytics_loads_before_interactive_components(self):
        html = (build_frontend.SOURCE_DIR / "production_planner.html").read_text(encoding="utf-8")
        self.assertLess(html.index('src="planner_analytics.js'), html.index('src="material_picker.js'))

    def test_frontend_does_not_expose_repository_or_manual_report_ui(self):
        source_files = [
            build_frontend.SOURCE_DIR / "production_planner.html",
            build_frontend.SOURCE_DIR / "production_planner.js",
            build_frontend.SOURCE_DIR / "planner_diagnostics.js",
            build_frontend.SOURCE_DIR / "planner_analytics.js",
            *sorted((build_frontend.SOURCE_DIR / "i18n").glob("ui.*.json")),
        ]
        combined = "\n".join(path.read_text(encoding="utf-8") for path in source_files)
        self.assertNotIn("github.com", combined.lower())
        self.assertNotIn("PyotrIlyichTchaikovsky", combined)
        self.assertNotIn("reportProblemButton", combined)
        self.assertNotIn("diagnosticsDialog", combined)

    def test_privacy_notice_describes_anonymous_analytics(self):
        privacy = (build_frontend.SOURCE_DIR / "privacy.html").read_text(encoding="utf-8")
        self.assertIn("每天更换", privacy)
        self.assertIn("does not contain factory plan contents", privacy)
        self.assertIn("?analytics_test=1", privacy)

    def test_analytics_endpoint_is_public_config_and_allowed_by_csp(self):
        with patch.dict(build_frontend.os.environ, {"PLANNER_ANALYTICS_ENDPOINT":"https://analytics.example/events"}, clear=True):
            config = build_frontend.frontend_config()
        self.assertEqual(config["analyticsEndpoint"], "https://analytics.example/events")
        self.assertIn("https://analytics.example", build_frontend.content_security_policy(config))
        self.assertIn('"analyticsEndpoint": "https://analytics.example/events"', build_frontend.render_planner_config(config))

    def test_all_supported_locales_build_with_content_hashed_assets(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            assets = build_frontend.write_localization_assets(Path(temp_dir))
            self.assertEqual(len(assets), 13)
            self.assertTrue(all(set(value) == {"ui", "game"} for value in assets.values()))
            self.assertTrue(all("i18n/" in value["game"] for value in assets.values()))

    def test_release_manifest_lists_the_exact_localization_assets(self):
        config={"sentryRelease":"a"*40,"sentryEnvironment":"staging","releaseVersion":"v2026.09.21.1.1",
                "apiBaseUrl":"https://api.example","localizationAssets":{"en-US":{"ui":"i18n/ui.en-US.1234567890.json","game":"i18n/game.en-US.1234567890.json"}}}
        with patch.dict(build_frontend.os.environ,{"RELEASE_ID":"1-1"},clear=True):
            manifest=build_frontend.release_manifest(config)
        self.assertEqual(manifest["localizationAssets"],config["localizationAssets"])

    def test_game_localization_manifest_has_full_recipe_and_device_coverage(self):
        manifest = json.loads((build_frontend.SOURCE_DIR / "i18n" / "game-data-manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["gameBuildId"], "24656030")
        self.assertFalse(manifest["calculationDataChanged"])
        for locale in manifest["locales"]:
            coverage = manifest["coverage"][locale]
            self.assertEqual(coverage["items"], coverage["itemsExpected"])
            self.assertEqual(coverage["recipes"], coverage["recipesExpected"])
            self.assertEqual(coverage["devices"], coverage["devicesExpected"])

    def test_synthetic_power_items_describe_power_instead_of_buildings(self):
        for locale, labels in generate_localizations.POWER_LABELS.items():
            payload = json.loads((build_frontend.SOURCE_DIR / "i18n" / f"game.{locale}.json").read_text(encoding="utf-8"))
            for group, label in labels.items():
                group_class = f"Desc_Power_{group}_C"
                with self.subTest(locale=locale, group=group):
                    self.assertEqual(payload["items"][group_class], label)
                    member_names = [
                        value for key, value in payload["items"].items()
                        if key != group_class and key.startswith(f"Desc_Power_{group}_")
                    ]
                    self.assertTrue(member_names)
                    self.assertTrue(all(name.startswith(f"{label} (") for name in member_names))


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
