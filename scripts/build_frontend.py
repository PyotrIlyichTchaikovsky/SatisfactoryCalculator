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


def main() -> None:
    output_dir = Path(os.getenv("FRONTEND_OUTPUT_DIR", str(OUTPUT_DIR))).resolve()
    if output_dir == ROOT_DIR or output_dir == SOURCE_DIR or SOURCE_DIR.is_relative_to(output_dir):
        raise SystemExit(f"Refusing to clear unsafe frontend output directory: {output_dir}")
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    config = frontend_config()
    asset_names = write_hashed_assets(output_dir, config)
    copy_icon_assets(output_dir)

    html = render_html(SOURCE_DIR / "production_planner.html", config, asset_names)
    (output_dir / "index.html").write_text(html, encoding="utf-8")
    (output_dir / "production_planner.html").write_text(html, encoding="utf-8")
    (output_dir / "_headers").write_text(render_headers(config), encoding="utf-8")
    (output_dir / "robots.txt").write_text(render_robots(config["publicSiteUrl"]), encoding="utf-8")
    (output_dir / "sitemap.xml").write_text(render_sitemap(config["publicSiteUrl"]), encoding="utf-8")

    ads_txt = render_ads_txt(config["adsenseClient"])
    if ads_txt:
        (output_dir / "ads.txt").write_text(ads_txt, encoding="utf-8")

    print(f"Built frontend into {output_dir}")


def write_hashed_assets(output_dir: Path, config: dict[str, object]) -> dict[str, str]:
    assets = {
        "production_planner.css": (SOURCE_DIR / "production_planner.css").read_bytes(),
        "production_planner.js": (SOURCE_DIR / "production_planner.js").read_bytes(),
        "planner_config.js": render_planner_config(config).encode("utf-8"),
    }
    asset_names = {}
    for source_name, content in assets.items():
        stem, suffix = source_name.rsplit(".", 1)
        hashed_name = f"{stem}.{content_hash(content)}.{suffix}"
        (output_dir / hashed_name).write_bytes(content)
        asset_names[source_name] = hashed_name
    return asset_names


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
        "adsenseClient": adsense_client,
        "adsenseEnabled": env_bool("ADSENSE_ENABLED", bool(adsense_client)),
        "publicSiteUrl": normalize_site_url(env("PUBLIC_SITE_URL")),
        "sentryBrowserScriptUrl": env("SENTRY_BROWSER_SCRIPT_URL"),
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
            "",
            "/",
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

    sentry_script_origin = origin_from_url(str(config["sentryBrowserScriptUrl"]))
    if sentry_script_origin:
        script_src.append(sentry_script_origin)
    if config["sentryDsn"]:
        connect_src.extend(["https://*.ingest.sentry.io", "https://*.ingest.us.sentry.io"])

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


def origin_from_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def escape_attr(value: str) -> str:
    return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def escape_xml(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    main()
