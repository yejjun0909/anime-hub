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
import socket
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


def local_ips() -> list[str]:
    """같은 Wi-Fi의 휴대폰에서 접속할 수 있는 PC 주소를 찾습니다."""
    addresses: set[str] = set()
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            address = info[4][0]
            if not address.startswith("127."):
                addresses.add(address)
    except OSError:
        pass
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))
            addresses.add(probe.getsockname()[0])
        finally:
            probe.close()
    except OSError:
        pass
    return sorted(addresses)


def main() -> int:
    parser = argparse.ArgumentParser(description="애니허브 로컬 정적 서버")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8123)
    parser.add_argument(
        "--lan",
        action="store_true",
        help="같은 Wi-Fi의 휴대폰에서 접속할 수 있게 0.0.0.0에 바인딩합니다.",
    )
    args = parser.parse_args()
    if args.lan:
        args.host = "0.0.0.0"

    handler = functools.partial(Handler, directory=str(ROOT))
    with socketserver.ThreadingTCPServer((args.host, args.port), handler) as httpd:
        httpd.allow_reuse_address = True
        print(f"애니허브: http://{args.host}:{args.port}/")
        if args.host == "0.0.0.0":
            for address in local_ips():
                print(f"휴대폰 접속 주소: http://{address}:{args.port}/")
            print("PC와 휴대폰이 같은 Wi-Fi에 있어야 하며, Windows 방화벽 허용이 필요할 수 있습니다.")
        print(f"루트: {ROOT}")
        print("종료: Ctrl+C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 종료합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
