"""`data/search-aliases.js`의 인기 검색어/동의어 목록을 정리합니다.

- 인기 검색어: 중복 제거(순서 유지), 누락된 쉼표 보정
- 동의어: 중복 키 제거(첫 값 유지)
- 결과는 읽기 쉬운 형태로 다시 씁니다.

사용:
    py tools/clean_search_aliases.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "data" / "search-aliases.js"

POPULAR_RE = re.compile(r"export const POPULAR_SEARCHES = \[(.*?)\n\];", re.S)
SYNONYM_RE = re.compile(r"export const SEARCH_SYNONYMS = \{(.*?)\n\};", re.S)
STRING_RE = re.compile(r"'([^']*)'|\"([^\"]*)\"")
PAIR_RE = re.compile(r"['\"]([^'\"]+)['\"]\s*:\s*['\"]([^'\"]*)['\"]")


def main() -> int:
    source = PATH.read_text(encoding="utf-8")

    popular_match = POPULAR_RE.search(source)
    synonym_match = SYNONYM_RE.search(source)
    if not popular_match or not synonym_match:
        raise SystemExit("POPULAR_SEARCHES 또는 SEARCH_SYNONYMS 블록을 찾지 못했습니다.")

    popular: list[str] = []
    for match in STRING_RE.finditer(popular_match.group(1)):
        value = (match.group(1) or match.group(2) or "").strip()
        if value and value not in popular:
            popular.append(value)

    synonyms: dict[str, str] = {}
    for match in PAIR_RE.finditer(synonym_match.group(1)):
        key, value = match.group(1).strip(), match.group(2).strip()
        if key and value and key not in synonyms:
            synonyms[key] = value

    popular_block = ",\n".join(f"  {json.dumps(item, ensure_ascii=False)}" for item in popular)
    synonym_block = ",\n".join(
        f"  {json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)}"
        for key, value in synonyms.items()
    )

    header = (
        "// 인기 검색어/별칭 (v4.7+)\n"
        "export const POPULAR_SEARCHES = [\n"
        f"{popular_block}\n"
        "];\n\n"
        "export const SEARCH_SYNONYMS = {\n"
        f"{synonym_block}\n"
        "};\n\n"
    )
    tail = source[synonym_match.end():]
    source = header + tail.lstrip("\n")
    PATH.write_text(source, encoding="utf-8", newline="\n")

    print(f"인기 검색어 {len(popular)}개 · 동의어 {len(synonyms)}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
