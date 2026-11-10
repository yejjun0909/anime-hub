#!/usr/bin/env python3
"""한국어 제목 → AniList 작품/검색어 인덱스를 생성합니다.

`data/korean-common-titles.js`(MAL ID → 한국어 제목)와
`data/korean-catalog.json`(검증된 한국어 제목)을 모아, AniList에서
로마자/영어 제목을 가져와 `data/korean-title-index.js`를 만듭니다.

이 인덱스가 있으면 사용자가 "원령공주"처럼 한국어 제목으로 검색해도
AniList에 로마자 제목으로 질의할 수 있습니다.

사용:
    py tools/build_title_index.py
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMON_JS = ROOT / "data" / "korean-common-titles.js"
CATALOG_JSON = ROOT / "data" / "korean-catalog.json"
PLATFORM_JSON = ROOT / "data" / "korean-platform-catalog.json"
OUTPUT_JS = ROOT / "data" / "korean-title-index.js"
ANILIST_URL = "https://graphql.anilist.co"
USER_AGENT = "anime-hub-title-index/1.0"

ENTRY_RE = re.compile(r"^\s*(\d+):\s*(['\"])(.*?)\2\s*,?\s*$", re.M)

QUERY = """
query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(idMal_in: $ids, type: ANIME) {
      id
      idMal
      title { romaji english native }
    }
  }
}
"""


def post_json(payload, retries=3):
    for attempt in range(retries):
        request = urllib.request.Request(
            ANILIST_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < retries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    raise RuntimeError("AniList 요청 실패")


def has_hangul(text: str) -> bool:
    return any("\uac00" <= ch <= "\ud7a3" for ch in (text or ""))


def load_common_titles() -> dict[str, str]:
    source = COMMON_JS.read_text(encoding="utf-8")
    return {key: value for key, _quote, value in ENTRY_RE.findall(source)}


def load_catalog_titles() -> dict[str, str]:
    if not CATALOG_JSON.exists():
        return {}
    data = json.loads(CATALOG_JSON.read_text(encoding="utf-8"))
    result: dict[str, str] = {}
    for record in data.get("records", []) or []:
        mal_id = record.get("malId")
        title = str(record.get("title") or "").strip()
        if mal_id and title and has_hangul(title):
            result[str(mal_id)] = title
    return result


def load_platform_records() -> list[dict]:
    """국내 플랫폼에서 직접 확인한 제목을 검색 인덱스 별칭으로 추가합니다."""
    if not PLATFORM_JSON.exists():
        return []
    data = json.loads(PLATFORM_JSON.read_text(encoding="utf-8"))
    records: list[dict] = []
    for record in data.get("records", []) or []:
        if record.get("status") not in {"verified", "alias"}:
            continue
        mal_id = record.get("malId")
        ani_id = record.get("anilistId")
        title = str(record.get("title") or "").strip()
        if not (isinstance(mal_id, int) and isinstance(ani_id, int) and has_hangul(title)):
            continue
        records.append({"malId": mal_id, "anilistId": ani_id, "title": title})
    return records


def fetch_media(ids: list[int]) -> list[dict]:
    data = post_json({"query": QUERY, "variables": {"ids": ids}})
    page = (data.get("data") or {}).get("Page") or {}
    return page.get("media") or []


def js_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="한국어 제목 인덱스 생성")
    parser.add_argument("--output", default=str(OUTPUT_JS))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    titles = load_common_titles()
    catalog = load_catalog_titles()
    # 카탈로그의 검증된 제목을 우선합니다.
    titles.update(catalog)

    platform_records = load_platform_records()
    platform_titles = {
        str(record["malId"]): record["title"] for record in platform_records
    }
    seed_titles = dict(titles)
    # 국내 플랫폼에서 직접 확인한 표기를 가장 우선합니다.
    titles.update(platform_titles)

    mal_ids = sorted({int(key) for key in titles if str(key).isdigit()})
    print(f"대상 MAL ID: {len(mal_ids)}개")

    media_by_mal: dict[int, dict] = {}
    for start in range(0, len(mal_ids), 50):
        chunk = mal_ids[start : start + 50]
        try:
            media = fetch_media(chunk)
        except Exception as error:  # noqa: BLE001
            print(f"  요청 실패({start}-{start + len(chunk) - 1}): {error}")
            time.sleep(3)
            continue
        for item in media:
            mal_id = item.get("idMal")
            if mal_id:
                media_by_mal[int(mal_id)] = item
        print(f"  {min(start + 50, len(mal_ids))}/{len(mal_ids)} 조회")
        time.sleep(1)

    entries: dict[str, dict] = {}
    entry_by_mal: dict[int, dict] = {}
    for mal_id in mal_ids:
        korean = titles.get(str(mal_id))
        item = media_by_mal.get(mal_id)
        if not korean or not item:
            continue
        title = item.get("title") or {}
        romaji = str(title.get("romaji") or "").strip()
        english = str(title.get("english") or "").strip()
        if not romaji and not english:
            continue
        entry = {
            "malId": mal_id,
            "anilistId": item.get("id"),
            "romaji": romaji,
            "english": english,
            "searchTerm": english or romaji,
        }
        entry_by_mal[mal_id] = entry
        # 같은 한국어 제목이 여러 작품에 매핑되면 영어 제목이 있는 쪽을 유지합니다.
        existing = entries.get(korean)
        if existing and existing.get("english") and not english:
            continue
        entries[korean] = entry

    # 플랫폼 표기와 기존 시드 표기를 모두 검색 별칭으로 남깁니다.
    for record in platform_records:
        entry = entry_by_mal.get(record["malId"])
        if entry:
            entries.setdefault(record["title"], entry)
    for mal_key, seed_title in seed_titles.items():
        entry = entry_by_mal.get(int(mal_key))
        if entry:
            entries.setdefault(seed_title, entry)

    print(f"인덱스 항목: {len(entries)}개")
    if args.dry_run:
        print("dry-run: 파일을 쓰지 않았습니다.")
        return 0

    lines = []
    for korean, entry in sorted(entries.items()):
        lines.append(
            f"  {js_string(korean)}: {{ malId: {entry['malId']}, anilistId: "
            f"{js_string(str(entry['anilistId']))}, romaji: {js_string(entry['romaji'])}, "
            f"english: {js_string(entry['english'])}, searchTerm: {js_string(entry['searchTerm'])} }},"
        )

    template = f"""// 자동 생성 파일입니다. 직접 수정하지 마세요.
// 생성: py tools/build_title_index.py
//
// 한국어 공통/검증 제목을 AniList 로마자·영어 제목과 연결합니다.
// 검색 시 한국어 제목을 네트워크 질의어로 변환하는 용도로만 사용합니다.

export const KOREAN_TITLE_INDEX = Object.freeze({{
{chr(10).join(lines)}
}});

const NORMALIZED = new Map();
for (const [title, entry] of Object.entries(KOREAN_TITLE_INDEX)) {{
  NORMALIZED.set(normalizeTitleKey(title), {{ title, ...entry }});
}}
const KEYS = [...NORMALIZED.keys()];

export function normalizeTitleKey(value) {{
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\\s\\p{{P}}\\p{{S}}]+/gu, '')
    .replace(/시즌\\d+|season\\d+/g, '');
}}

function levenshtein(a, b) {{
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({{ length: b.length + 1 }}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {{
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {{
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }}
    prev = curr;
  }}
  return prev[b.length];
}}

function similarity(a, b) {{
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}}

/**
 * 한국어 제목으로 인덱스 항목을 찾습니다.
 * @returns object|null 인덱스 항목 (title, malId, anilistId, romaji, english, searchTerm)
 */
export function findKoreanTitleEntry(query, threshold = 0.72) {{
  const normalized = normalizeTitleKey(query);
  if (!normalized || !KEYS.length) return null;
  const exact = NORMALIZED.get(normalized);
  if (exact) return exact;
  let best = null;
  let bestScore = 0;
  for (const key of KEYS) {{
    const score = similarity(normalized, key);
    if (score > bestScore) {{
      bestScore = score;
      best = NORMALIZED.get(key) || null;
    }}
  }}
  return bestScore >= threshold ? best : null;
}}
"""
    Path(args.output).write_text(template, encoding="utf-8", newline="\n")
    print(f"작성: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
