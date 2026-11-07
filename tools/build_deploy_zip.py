#!/usr/bin/env python3
"""배포용 정적 사이트 ZIP을 만듭니다.

사이트 실행에 필요한 파일만 담습니다.
- 포함: index.html, app.js, styles.css, sw.js, manifest, offline, robots, sitemap, _headers,
        assets/, data/(수확 원본 제외), supabase/schema.sql, 단일 파일 사본, 배포 문서
- 제외: tools/, tests/, .git/, .github/, 개발 문서, 수확 원본 JSON

사용:
    py tools/build_deploy_zip.py
    py tools/build_deploy_zip.py --out C:/Users/me/Desktop/anime-hub.zip
"""
from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT.parent / "anime-hub-deploy.zip"

ROOT_FILES = [
    "index.html",
    "app.js",
    "styles.css",
    "sw.js",
    "manifest.webmanifest",
    "offline.html",
    "robots.txt",
    "sitemap.xml",
    "_headers",
    "VERSION.txt",
    "README.md",
    "DEPLOY_NO_INSTALL_KO.md",
    "anime-hub-single.html",
]

# data/ 안에서 배포에 넣지 않는 파일(수확 중간 산출물).
EXCLUDED_DATA_SUFFIXES = (".harvest.json", "harvest2.json", "harvest4.json", "harvest5.json",
                          "harvest6.json", "harvest7.json", "harvest8.json", "harvest9.json")


def collect() -> list[Path]:
    files: list[Path] = []
    for name in ROOT_FILES:
        path = ROOT / name
        if path.exists():
            files.append(path)
        else:
            print(f"경고: 필수 파일이 없습니다: {name}")

    for folder in ("assets", "data"):
        for path in sorted((ROOT / folder).rglob("*")):
            if not path.is_file():
                continue
            if folder == "data" and any(path.name.endswith(suffix) for suffix in EXCLUDED_DATA_SUFFIXES):
                continue
            if folder == "data" and "schedule-snapshots" in path.parts:
                continue
            files.append(path)

    schema = ROOT / "supabase" / "schema.sql"
    if schema.exists():
        files.append(schema)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="배포용 ZIP 생성")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    files = collect()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())

    names = {path.relative_to(ROOT).as_posix() for path in files}
    missing = [name for name in ("index.html", "app.js", "sw.js", "data/korean-title-index.js",
                                 "data/korean-titles-db.json") if name not in names]
    if missing:
        print(f"실패: ZIP에 필요한 파일이 없습니다: {', '.join(missing)}")
        return 1

    print(f"작성: {output} ({output.stat().st_size:,} bytes, {len(files)}개 파일)")
    print("포함 예시:", ", ".join(sorted(names)[:6]), "…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
