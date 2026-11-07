#!/usr/bin/env python3
"""애니허브 로컬 개발 서버.

일반 사이트처럼 `index.html`을 브라우저에서 열어 확인할 때 사용합니다.
앱 코드는 캐시하지 않도록 `Cache-Control: no-store`를 보냅니다.

사용:
    py tools/serve.py
    py tools/serve.py --port 8124
    py tools/serve.py --host 0.0.0.0
"""

from __future__ import annotations

import argparse
import functools
import http.server
import mimetypes
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> int:
    parser = argparse.ArgumentParser(description="애니허브 로컬 정적 서버")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8123)
    args = parser.parse_args()

    handler = functools.partial(Handler, directory=str(ROOT))
    with socketserver.ThreadingTCPServer((args.host, args.port), handler) as httpd:
        httpd.allow_reuse_address = True
        print(f"애니허브: http://{args.host}:{args.port}/")
        print(f"루트: {ROOT}")
        print("종료: Ctrl+C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 종료합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
