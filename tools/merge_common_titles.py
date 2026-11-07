#!/usr/bin/env python3
"""수확한 AniList 한국어 별칭 JSON을 `data/korean-common-titles.js`에 병합합니다.

사용:
    py tools/merge_common_titles.py data/korean-common-titles.harvest6.json data/korean-common-titles.harvest7.json

- 기존 MAL ID는 덮어쓰지 않습니다(수동 큐레이션 우선).
- 카탈로그(data/korean-catalog.json)에 이미 있는 MAL ID는 건너뜁니다.
- 결과는 MAL ID 숫자 오름차순으로 정렬합니다.
- 항목이 하나도 추가되지 않으면 파일을 수정하지 않습니다.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JS = ROOT / "data" / "korean-common-titles.js"
CATALOG = ROOT / "data" / "korean-catalog.json"

HEADER_RE = re.compile(
    r"(export const COMMON_KOREAN_TITLES = Object\.freeze\(\{)(.*?)(\n\}\);)",
    re.S,
)
ENTRY_RE = re.compile(r"^\s*(\d+):\s*(['\"])(.*?)\2\s*,?\s*$", re.M)


def load_catalog_ids() -> set[str]:
    if not CATALOG.exists():
        return set()
    try:
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return set()
    ids = set()
    for record in data.get("records", []) or []:
        mal_id = record.get("malId") or record.get("idMal") or record.get("mal_id")
        if mal_id:
            ids.add(str(mal_id))
    return ids


def valid_title(value: str) -> bool:
    if not isinstance(value, str):
        return False
    value = value.strip()
    if not (2 <= len(value) <= 40):
        return False
    if not any("\uac00" <= ch <= "\ud7a3" for ch in value):
        return False
    # 기계 번역 표식이 섞인 값은 신뢰하지 않습니다.
    lowered = value.lower()
    return not any(token in lowered for token in ("[mt]", "mt:", "machine", "auto-translate"))


def main() -> int:
    parser = argparse.ArgumentParser(description="공통 한국어 제목 병합")
    parser.add_argument("harvest", nargs="+", help="수확 JSON 파일 경로")
    parser.add_argument("--js", default=str(DEFAULT_JS), help="대상 JS 파일")
    parser.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 결과만 확인")
    args = parser.parse_args()

    js_path = Path(args.js)
    source = js_path.read_text(encoding="utf-8")
    match = HEADER_RE.search(source)
    if not match:
        raise SystemExit(f"대상 객체를 찾지 못했습니다: {js_path}")

    existing: dict[str, str] = {}
    for key, _quote, value in ENTRY_RE.findall(match.group(2)):
        existing[str(key)] = value

    catalog_ids = load_catalog_ids()
    added: dict[str, str] = {}
    skipped = 0
    for harvest_path in args.harvest:
        path = Path(harvest_path)
        if not path.exists():
            print(f"건너뜀(없음): {path}")
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for key, value in data.items():
            key = str(key)
            if not key.isdigit():
                continue
            if key in existing or key in added or key in catalog_ids:
                continue
            if not valid_title(value):
                skipped += 1
                continue
            added[key] = value.strip()

    print(f"기존 {len(existing)}개 · 신규 {len(added)}개 · 제외 {skipped}개")
    if not added:
        print("추가할 항목이 없습니다.")
        return 0

    merged = dict(existing)
    merged.update(added)
    lines = "".join(
        f"  {key}: {json.dumps(value, ensure_ascii=False)},\n"
        for key, value in sorted(merged.items(), key=lambda item: int(item[0]))
    )
    # group(3)는 "\n});" 이므로 개행을 그대로 유지합니다.
    new_source = source[: match.start(2)] + "\n" + lines.rstrip("\n") + source[match.start(3) :]

    if args.dry_run:
        print("dry-run: 파일을 수정하지 않았습니다.")
        return 0

    js_path.write_text(new_source, encoding="utf-8", newline="\n")
    print(f"갱신: {js_path} ({len(merged)}개)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
