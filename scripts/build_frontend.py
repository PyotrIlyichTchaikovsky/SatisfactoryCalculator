from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT_DIR / "satisfactory_calculator" / "recipe_web"
OUTPUT_DIR = ROOT_DIR / "dist" / "frontend"


def application_digest() -> str:
    files = [SOURCE_DIR / name for name in ("production_planner.html", "privacy.html", "production_planner.css", "production_planner.js", "material_picker.js", "planner_analytics.js", "planner_diagnostics.js", "planner_i18n.js", "data/Data.xlsx")]
    files += sorted((SOURCE_DIR / "i18n").glob("*.json"))
    files += sorted((SOURCE_DIR / "data" / "icons").rglob("*.png"))
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(SOURCE_DIR).as_posix().encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def release_manifest(config: dict[str, object]) -> dict[str, object]:
    return {"schema": 1, "sha": config["sentryRelease"],
            "environment": config["sentryEnvironment"], "releaseId": env("RELEASE_ID"),
            "version": config["releaseVersion"],
            "apiBaseUrl": config["apiBaseUrl"], "applicationDigest": application_digest(),
            "dataVersion": hashlib.sha256((SOURCE_DIR / "data" / "Data.xlsx").read_bytes()).hexdigest()[:16],
            "localizationVersion": localization_digest(),
            "configDigest": hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()}


def main() -> None:
    output_dir = Path(os.getenv("FRONTEND_OUTPUT_DIR", str(OUTPUT_DIR))).resolve()
    if output_dir == ROOT_DIR or output_dir == SOURCE_DIR or SOURCE_DIR.is_relative_to(output_dir):
        raise SystemExit(f"Refusing to clear unsafe frontend output directory: {output_dir}")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    config = frontend_config()
    config["localizationAssets"] = write_localization_assets(output_dir)
    asset_names = write_hashed_assets(output_dir, config)
    copy_icon_assets(output_dir)

    html = render_html(SOURCE_DIR / "production_planner.html", config, asset_names)
    (output_dir / "index.html").write_text(html, encoding="utf-8")
    (output_dir / "production_planner.html").write_text(html, encoding="utf-8")
    shutil.copyfile(SOURCE_DIR / "privacy.html", output_dir / "privacy.html")
    (output_dir / "_headers").write_text(render_headers(config), encoding="utf-8")
    is_staging = config["sentryEnvironment"] == "staging"
    (output_dir / "robots.txt").write_text("User-agent: *\nDisallow: /\n" if is_staging else render_robots(config["publicSiteUrl"]), encoding="utf-8")
    (output_dir / "sitemap.xml").write_text(render_sitemap("" if is_staging else config["publicSiteUrl"]), encoding="utf-8")

    ads_txt = render_ads_txt(config["adsenseClient"])
    if ads_txt:
        (output_dir / "ads.txt").write_text(ads_txt, encoding="utf-8")

    manifest = release_manifest(config)
    (output_dir / "release.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Built frontend into {output_dir}")


def write_hashed_assets(output_dir: Path, config: dict[str, object]) -> dict[str, str]:
    assets = {
        "production_planner.css": (SOURCE_DIR / "production_planner.css").read_bytes(),
        "planner_diagnostics.js": (SOURCE_DIR / "planner_diagnostics.js").read_bytes(),
        "planner_analytics.js": (SOURCE_DIR / "planner_analytics.js").read_bytes(),
        "material_picker.js": (SOURCE_DIR / "material_picker.js").read_bytes(),
        "production_planner.js": (SOURCE_DIR / "production_planner.js").read_bytes(),
        "planner_i18n.js": (SOURCE_DIR / "planner_i18n.js").read_bytes(),
        "planner_config.js": render_planner_config(config).encode("utf-8"),
    }
    asset_names = {}
    for source_name, content in assets.items():
        stem, suffix = source_name.rsplit(".", 1)
        hashed_name = f"{stem}.{content_hash(content)}.{suffix}"
        (output_dir / hashed_name).write_bytes(content)
        asset_names[source_name] = hashed_name
    return asset_names


def write_localization_assets(output_dir: Path) -> dict[str, dict[str, str]]:
    target_dir = output_dir / "i18n"
    target_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, dict[str, str]] = {}
    for source in sorted((SOURCE_DIR / "i18n").glob("*.json")):
        match = re.fullmatch(r"(ui|game)\.([A-Za-z-]+)\.json", source.name)
        if not match:
            continue
        kind, locale = match.groups()
        content = source.read_bytes()
        filename = f"{kind}.{locale}.{content_hash(content)}.json"
        (target_dir / filename).write_bytes(content)
        result.setdefault(locale, {})[kind] = f"i18n/{filename}"
    expected = {"en-US", "fr-FR", "it-IT", "de-DE", "es-ES", "ja-JP", "ko-KR", "pl-PL", "pt-BR", "ru-RU", "zh-CN", "zh-TW", "uk-UA"}
    incomplete = sorted(locale for locale in expected if set(result.get(locale, {})) != {"ui", "game"})
    if incomplete:
        raise SystemExit(f"Incomplete localization assets: {', '.join(incomplete)}")
    return result


def localization_digest() -> str:
    digest = hashlib.sha256()
    for path in sorted((SOURCE_DIR / "i18n").glob("*.json")):
        digest.update(path.name.encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()[:16]


def copy_icon_assets(output_dir: Path) -> None:
    icons_dir = SOURCE_DIR / "data" / "icons"
    if icons_dir.exists():
        shutil.copytree(icons_dir, output_dir / "data" / "icons")


def frontend_config() -> dict[str, object]:
    adsense_client = env("ADSENSE_CLIENT")
    return {
        "apiBaseUrl": env("PLANNER_API_BASE_URL"),
        "sentryDsn": env("SENTRY_DSN"),
        "sentryEnvironment": env("SENTRY_ENVIRONMENT", "production"),
        "sentryRelease": env("SENTRY_RELEASE"),
        "releaseVersion": env("RELEASE_VERSION"),
        "adsenseClient": adsense_client,
        "adsenseEnabled": env_bool("ADSENSE_ENABLED", bool(adsense_client)),
        "publicSiteUrl": normalize_site_url(env("PUBLIC_SITE_URL")),
        "sentryBrowserScriptUrl": env("SENTRY_BROWSER_SCRIPT_URL"),
        "analyticsEndpoint": normalize_event_endpoint(env("PLANNER_ANALYTICS_ENDPOINT")),
    }


def render_html(source_path: Path, config: dict[str, object], asset_names: dict[str, str]) -> str:
    html = source_path.read_text(encoding="utf-8")
    injections: list[str] = []
    sentry_script_url = str(config["sentryBrowserScriptUrl"])
    if sentry_script_url:
        injections.append(f'  <script defer src="{escape_attr(sentry_script_url)}" crossorigin="anonymous"></script>')

    adsense_client = str(config["adsenseClient"])
    if config["adsenseEnabled"] and adsense_client:
        client = escape_attr(adsense_client)
        injections.append(
            "  <script async "
            f'src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={client}" '
            'crossorigin="anonymous"></script>'
        )

    public_site_url = str(config["publicSiteUrl"])
    if public_site_url and "<link rel=\"canonical\"" not in html:
        html = html.replace(
            "  <title>Satisfactory Production Planner</title>",
            "  <title>Satisfactory Production Planner</title>\n"
            f'  <link rel="canonical" href="{escape_attr(public_site_url)}/">',
        )

    if config["releaseVersion"]:
        prefix = "Release test environment · Version" if config["sentryEnvironment"] == "staging" else "Version"
        version = escape_attr(str(config["releaseVersion"]))
        html = html.replace('<p id="dataSummary"', f'<p id="releaseLabel">{prefix} {version}</p>\n      <p id="dataSummary"', 1)
    if config["sentryEnvironment"] == "staging":
        html = html.replace("</head>", '  <meta name="robots" content="noindex, nofollow">\n</head>', 1)
    if injections:
        marker = '  <script defer src="planner_config.js'
        html = html.replace(marker, "\n".join(injections) + "\n" + marker, 1)
    return replace_asset_references(html, asset_names)


def render_planner_config(config: dict[str, object]) -> str:
    public_config = {
        "apiBaseUrl": config["apiBaseUrl"],
        "sentryDsn": config["sentryDsn"],
        "sentryEnvironment": config["sentryEnvironment"],
        "sentryRelease": config["sentryRelease"],
        "adsenseClient": config["adsenseClient"],
        "adsenseEnabled": config["adsenseEnabled"],
        "analyticsEndpoint": config["analyticsEndpoint"],
        "localizationAssets": config.get("localizationAssets", {}),
    }
    return "window.PLANNER_CONFIG = " + json.dumps(public_config, ensure_ascii=False, indent=2) + ";\n"


def render_headers(config: dict[str, object]) -> str:
    csp = content_security_policy(config)
    return "\n".join(
        [
            "/*",
            "  X-Content-Type-Options: nosniff",
            "  Referrer-Policy: strict-origin-when-cross-origin",
            "  X-Frame-Options: DENY",
            f"  Content-Security-Policy: {csp}",
            *( ["  X-Robots-Tag: noindex, nofollow"] if config["sentryEnvironment"] == "staging" else [] ),
            "",
            "/",
            "  Cache-Control: no-store, max-age=0",
            "",
            "/release.json",
            "  Cache-Control: no-store, max-age=0",
            "",
            "/index.html",
            "  Cache-Control: no-store, max-age=0",
            "",
            "/production_planner.html",
            "  Cache-Control: no-store, max-age=0",
            "",
            "/*.js",
            "  Cache-Control: public, max-age=31536000, immutable",
            "",
            "/*.css",
            "  Cache-Control: public, max-age=31536000, immutable",
            "",
            "/data/icons/*",
            "  Cache-Control: public, max-age=2592000",
            "",
            "/i18n/*",
            "  Cache-Control: public, max-age=31536000, immutable",
            "",
        ]
    )


def content_security_policy(config: dict[str, object]) -> str:
    script_src = ["'self'"]
    img_src = ["'self'", "data:"]
    connect_src = ["'self'"]
    frame_src = ["'none'"]

    api_origin = origin_from_url(str(config["apiBaseUrl"]))
    if api_origin:
        connect_src.append(api_origin)

    analytics_origin = origin_from_url(str(config.get("analyticsEndpoint", "")))
    if analytics_origin:
        connect_src.append(analytics_origin)

    sentry_script_origin = origin_from_url(str(config["sentryBrowserScriptUrl"]))
    if sentry_script_origin:
        script_src.append(sentry_script_origin)
    if config.get("sentryEnvironment") == "production":
        script_src.append("https://static.cloudflareinsights.com")
    if config["sentryDsn"]:
        sentry_origin = origin_from_url(str(config["sentryDsn"]))
        if sentry_origin:
            connect_src.append(sentry_origin)

    if config["adsenseEnabled"] and config["adsenseClient"]:
        script_src.extend(
            [
                "https://pagead2.googlesyndication.com",
                "https://fundingchoicesmessages.google.com",
            ]
        )
        img_src.extend(
            [
                "https://pagead2.googlesyndication.com",
                "https://googleads.g.doubleclick.net",
                "https://*.googleusercontent.com",
            ]
        )
        connect_src.extend(
            [
                "https://pagead2.googlesyndication.com",
                "https://googleads.g.doubleclick.net",
                "https://fundingchoicesmessages.google.com",
            ]
        )
        frame_src = [
            "https://googleads.g.doubleclick.net",
            "https://tpc.googlesyndication.com",
        ]

    directives = {
        "default-src": ["'self'"],
        "script-src": dedupe(script_src),
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": dedupe(img_src),
        "connect-src": dedupe(connect_src),
        "frame-src": dedupe(frame_src),
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
    }
    return "; ".join(f"{name} {' '.join(values)}" for name, values in directives.items())


def render_robots(public_site_url: str) -> str:
    lines = ["User-agent: *", "Allow: /"]
    if public_site_url:
        lines.append(f"Sitemap: {public_site_url}/sitemap.xml")
    return "\n".join(lines) + "\n"


def render_sitemap(public_site_url: str) -> str:
    if not public_site_url:
        return "\n".join(
            [
                '<?xml version="1.0" encoding="UTF-8"?>',
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
                "</urlset>",
                "",
            ]
        )
    loc = f"{public_site_url}/"
    return "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            "  <url>",
            f"    <loc>{escape_xml(loc)}</loc>",
            f"    <lastmod>{date.today().isoformat()}</lastmod>",
            "  </url>",
            "</urlset>",
            "",
        ]
    )


def render_ads_txt(adsense_client: str) -> str:
    if not adsense_client:
        return ""
    publisher_id = adsense_client.strip()
    if publisher_id.startswith("ca-"):
        publisher_id = publisher_id[3:]
    if publisher_id.startswith("pub-"):
        return f"google.com, {publisher_id}, DIRECT, f08c47fec0942fa0\n"
    return f"google.com, pub-{publisher_id}, DIRECT, f08c47fec0942fa0\n"


def replace_asset_references(html: str, asset_names: dict[str, str]) -> str:
    for source_name, hashed_name in asset_names.items():
        html = re.sub(rf"{re.escape(source_name)}(?:\?v=[^\"']*)?", hashed_name, html)
    return html


def content_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()[:10]


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def normalize_site_url(value: str) -> str:
    if not value:
        return ""
    return value.rstrip("/")


def normalize_event_endpoint(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SystemExit("PLANNER_ANALYTICS_ENDPOINT must be an HTTPS URL without credentials, query, or fragment")
    return value.rstrip("/")


def origin_from_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc.rsplit(chr(64), 1)[-1]}"


def dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def escape_attr(value: str) -> str:
    return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def escape_xml(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    main()
