#!/usr/bin/env python3
"""Git 자동 배포용 정적 사이트 폴더를 만듭니다.

GitHub Actions, Netlify, Cloudflare Pages 같은 정적 호스팅에서
`_site/`를 배포 산출물로 사용합니다.

사용:
    py tools/build_site.py
    # 또는
    py tools/build_deploy_dir.py
    py tools/build_deploy_dir.py --out C:/temp/anime-hub-site
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deploy_files import REQUIRED, ROOT, collect  # noqa: E402

DEFAULT_OUT = ROOT / "_site"
CACHE_BUSTED_ASSETS = ("styles.css", "app.js", "manifest.webmanifest")


def asset_version(files: list[Path]) -> str:
    """앱 코드와 데이터의 내용 해시로 배포 버전 토큰을 만듭니다."""
    digest = hashlib.sha256()
    for path in sorted(files, key=lambda item: item.relative_to(ROOT).as_posix()):
        relative = path.relative_to(ROOT).as_posix()
        if relative in {"app.js", "styles.css", "sw.js"} or relative.startswith("data/"):
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(path.read_bytes())
    return digest.hexdigest()[:10]


def add_cache_busting(index: Path, version: str) -> None:
    """GitHub Pages CDN에 캐시된 HTML이 남아도 새 자산을 받도록 쿼리를 붙입니다."""
    html = index.read_text(encoding="utf-8")
    for asset in CACHE_BUSTED_ASSETS:
        html = html.replace(f'"{asset}"', f'"{asset}?v={version}"')
    index.write_text(html, encoding="utf-8", newline="\n")


def write_cache_manifest(output: Path, version: str) -> None:
    """배포 버전을 남겨 캐시 문제 확인에 사용합니다."""
    (output / "assets-version.txt").write_text(
        f"{version}\n", encoding="utf-8", newline="\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="자동 배포용 정적 사이트 폴더 생성")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    output = Path(args.out).resolve()
    if output == ROOT or ROOT.is_relative_to(output):
        print(f"실패: 프로젝트 폴더를 배포 산출물로 덮어쓸 수 없습니다: {output}", file=sys.stderr)
        return 1

    files = collect()
    if output.exists():
        shutil.rmtree(output)
    for path in files:
        destination = output / path.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)

    version = asset_version(files)
    add_cache_busting(output / "index.html", version)
    write_cache_manifest(output, version)

    names = {path.relative_to(ROOT).as_posix() for path in files}
    missing = [name for name in REQUIRED if name not in names]
    if missing:
        print(f"실패: 배포 폴더에 필요한 파일이 없습니다: {', '.join(missing)}", file=sys.stderr)
        return 1

    print(f"작성: {output} ({len(files)}개 파일, 자산 버전 {version})")
    print("포함 예시:", ", ".join(sorted(names)[:6]), "…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
