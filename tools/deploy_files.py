#!/usr/bin/env python3
"""배포에 포함할 파일 목록을 한 곳에서 관리합니다.

`build_deploy_zip.py`(수동 ZIP)와 `build_deploy_dir.py`(Git 자동 배포용 폴더)가
같은 목록을 사용하도록 분리했습니다.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

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
    "DEPLOY_AUTO_KO.md",
    "anime-hub-single.html",
]

# data/ 안에서 배포에 넣지 않는 파일(수확 중간 산출물).
EXCLUDED_DATA_MARKERS = ("harvest",)


def collect() -> list[Path]:
    """배포에 필요한 파일의 실제 경로 목록을 반환합니다."""
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
            if folder == "data" and any(marker in path.name.lower() for marker in EXCLUDED_DATA_MARKERS):
                continue
            if folder == "data" and path.name == "korean-platform-catalog.json":
                continue
            if folder == "data" and "schedule-snapshots" in path.parts:
                continue
            files.append(path)

    schema = ROOT / "supabase" / "schema.sql"
    if schema.exists():
        files.append(schema)
    return files


REQUIRED = (
    "index.html",
    "app.js",
    "sw.js",
    "data/korean-title-index.js",
    "data/korean-platform-catalog.js",
    "data/korean-platform-match.js",
    "data/korean-titles-db.json",
)
