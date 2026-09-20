"""Local CI preview, including the generated Cloudflare response headers."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from fnmatch import fnmatch
from urllib.parse import urlparse
import build_frontend


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        path = urlparse(self.path).path
        active = False
        headers = {}
        for line in (Path("dist/frontend") / "_headers").read_text(encoding="utf-8").splitlines():
            if line.startswith("/"):
                active = fnmatch(path, line.strip())
            elif active and line.startswith("  ") and ":" in line:
                name, value = line.strip().split(":", 1)
                headers[name] = value.strip()
        for name, value in headers.items():
            self.send_header(name, value)
        super().end_headers()


if __name__ == "__main__":
    build_frontend.main()
    ThreadingHTTPServer(("127.0.0.1", 8788), partial(Handler, directory="dist/frontend")).serve_forever()
