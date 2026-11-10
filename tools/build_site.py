#!/usr/bin/env python3
"""자동 배포에 필요한 산출물을 한 번에 만듭니다.

순서:
1. 플랫폼 카탈로그 JSON → 브라우저용 JS
2. 단일 HTML 재생성
3. 배포용 `_site/` 폴더 생성

GitHub Actions, Netlify, Cloudflare Pages의 빌드 명령으로 사용합니다.

사용:
    py tools/build_site.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = Path(__file__).resolve().parent

STEPS = (
    ("플랫폼 카탈로그 JS", TOOLS / "build_korean_platform_catalog.py"),
    ("단일 HTML", TOOLS / "build_single.py"),
    ("배포 폴더", TOOLS / "build_deploy_dir.py"),
)


def run(script: Path) -> None:
    print(f"\n== {script.name} ==", flush=True)
    subprocess.run([sys.executable, str(script)], cwd=ROOT, check=True)


def main() -> int:
    for label, script in STEPS:
        if not script.exists():
            print(f"실패: {label} 스크립트가 없습니다: {script}", file=sys.stderr)
            return 1
        try:
            run(script)
        except subprocess.CalledProcessError as error:
            print(f"실패: {label} 생성 중 오류 (exit {error.returncode})", file=sys.stderr)
            return error.returncode or 1
    print("\n완료: _site/ 자동 배포 준비됨")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
