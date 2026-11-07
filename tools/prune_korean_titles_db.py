#!/usr/bin/env python3
"""`data/korean-titles-db.json`에서 쓸모없는 빈 항목을 정리합니다.

표시할 한국어 제목도 없고 줄거리도 없는 항목은 파일 크기만 늘리므로 제거합니다.
검증 출처(`anilist`, `tmdb`, `mal`) 항목은 title이 비어 있어도 보존합니다.

사용:
    py tools/prune_korean_titles_db.py
    py tools/prune_korean_titles_db.py --dry-run
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "korean-titles-db.json"


def keep(entry: dict) -> bool:
    title = str(entry.get("title") or "").strip()
    overview = str(entry.get("overview") or "").strip()
    withheld = str(entry.get("withheldTitle") or "").strip()
    return bool(title or overview or withheld)


def main() -> int:
    parser = argparse.ArgumentParser(description="한국어 제목 DB 빈 항목 정리")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    path = Path(args.db)
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("entries", {}) or {}
    kept = {key: value for key, value in entries.items() if keep(value)}
    removed = len(entries) - len(kept)
    print(f"전체 {len(entries)}건 → 유지 {len(kept)}건 (제거 {removed}건)")

    if args.dry_run:
        print("dry-run: 파일을 수정하지 않았습니다.")
        return 0

    data["entries"] = kept
    data["count"] = len(kept)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(f"갱신: {path} ({path.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
