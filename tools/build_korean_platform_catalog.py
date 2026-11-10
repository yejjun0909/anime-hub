#!/usr/bin/env python3
"""data/korean-platform-catalog.json -> data/korean-platform-catalog.js 생성기.

브라우저는 JSON을 fetch하지 않고 생성된 ES 모듈을 정적 import합니다.
(오프라인 캐시와 file:// 이 아닌 정적 호스팅 모두에서 동작)

사용:
    py tools/build_korean_platform_catalog.py          # 생성
    py tools/build_korean_platform_catalog.py --check  # 커밋된 파일이 최신인지 확인 (CI)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "korean-platform-catalog.json"
TARGET = ROOT / "data" / "korean-platform-catalog.js"

HEADER = """// AUTO-GENERATED FILE — 직접 수정하지 마세요.
// 원본: data/korean-platform-catalog.json
// 생성: py tools/build_korean_platform_catalog.py
// 검사: py tools/build_korean_platform_catalog.py --check
//
// 국내 플랫폼(라프텔 등)에서 제목과 연도를 직접 확인한 작품만 담습니다.
// 기계 번역/AI 생성 결과는 포함하지 않습니다.
"""

FIELDS = (
    "workId",
    "anilistId",
    "malId",
    "platform",
    "platformId",
    "kind",
    "title",
    "overview",
    "source",
    "sourceUrl",
    "region",
    "checkedAt",
    "status",
    "year",
    "match",
    "note",
)


def load_catalog() -> dict:
    with SOURCE.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit("korean-platform-catalog.json 최상위는 객체여야 합니다.")
    records = data.get("records")
    if not isinstance(records, list):
        raise SystemExit("korean-platform-catalog.json에 records 배열이 없습니다.")
    platforms = data.get("platforms")
    if not isinstance(platforms, list) or not platforms:
        raise SystemExit("korean-platform-catalog.json에 platforms 배열이 없습니다.")

    normalized = []
    for index, record in enumerate(records):
        missing = [field for field in FIELDS if field not in record]
        if missing:
            raise SystemExit(f"records[{index}] 누락 필드: {', '.join(missing)}")
        extra = sorted(set(record) - set(FIELDS))
        normalized.append({field: record[field] for field in FIELDS})
        if extra:
            print(f"경고: records[{index}] 알 수 없는 필드 무시: {', '.join(extra)}", file=sys.stderr)

    return {
        "schemaVersion": data["schemaVersion"],
        "region": data["region"],
        "checkedAt": data.get("checkedAt"),
        "platforms": platforms,
        "records": normalized,
    }


def render(data: dict) -> str:
    meta = json.dumps(
        {
            "schemaVersion": data["schemaVersion"],
            "region": data["region"],
            "checkedAt": data["checkedAt"],
            "platforms": data["platforms"],
            "source": "data/korean-platform-catalog.json",
        },
        ensure_ascii=False,
        indent=2,
    )
    records = json.dumps(data["records"], ensure_ascii=False, indent=2)
    return (
        HEADER
        + f"export const KOREAN_PLATFORM_META = Object.freeze({meta});\n\n"
        + f"export const KOREAN_PLATFORM_CATALOG = Object.freeze({records});\n"
    )


def main(argv: list[str]) -> int:
    data = load_catalog()
    rendered = render(data)

    if "--check" in argv:
        if not TARGET.exists():
            print(f"실패: {TARGET.relative_to(ROOT)} 파일이 없습니다.", file=sys.stderr)
            return 1
        current = TARGET.read_text(encoding="utf-8")
        if current != rendered:
            print(
                "실패: data/korean-platform-catalog.js가 원본 JSON과 다릅니다.\n"
                "      py tools/build_korean_platform_catalog.py 를 실행해 다시 생성하세요.",
                file=sys.stderr,
            )
            return 1
        print(f"OK: {TARGET.relative_to(ROOT)} 최신 상태 ({len(data['records'])}건)")
        return 0

    TARGET.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"생성 완료: {TARGET.relative_to(ROOT)} ({len(data['records'])}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
