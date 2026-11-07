#!/usr/bin/env python3
"""AniList?먯꽌 ?쒓뎅??蹂꾩묶(synonyms)???섑솗??common titles ?꾨낫瑜?留뚮벊?덈떎.

?ъ슜:
    py tools/harvest_common_titles.py --pages 6 --output data/korean-common-titles.harvest.json

寃곌낵??JSON?쇰줈 ??λ맗?덈떎. 寃????data/korean-common-titles.js??蹂묓빀?섏꽭??
"""
from __future__ import annotations
import argparse
import json
import time
import urllib.request
from pathlib import Path

ANILIST_URL = "https://graphql.anilist.co"
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "data" / "korean-common-titles.harvest.json"

QUERY = """
query ($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: [POPULARITY_DESC]) {
      id
      idMal
      title { romaji english native }
      synonyms
    }
  }
}
"""

def post_json(payload):
    req = urllib.request.Request(
        ANILIST_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "anime-hub-harvester/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))

def has_hangul(text):
    return any("\uac00" <= ch <= "\ud7a3" for ch in (text or ""))

def pick_korean(synonyms):
    for s in synonyms or []:
        if has_hangul(s) and 2 <= len(s.strip()) <= 40:
            return s.strip()
    return None

def main():
    parser = argparse.ArgumentParser(description="AniList ?쒓뎅??蹂꾩묶 ?섑솗")
    parser.add_argument("--pages", type=int, default=6)
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--per-page", type=int, default=50)
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    output = Path(args.output)
    result = {}
    page = args.start_page
    last_page = args.start_page + args.pages - 1
    while page <= last_page:
        print(f"page {page}...")
        data = post_json({"query": QUERY, "variables": {"page": page, "perPage": args.per_page}})
        page_data = (data.get("data") or {}).get("Page") or {}
        media_list = page_data.get("media") or []
        has_next = page_data.get("pageInfo", {}).get("hasNextPage", False)
        for m in media_list:
            mal_id = m.get("idMal")
            if not mal_id:
                continue
            title = pick_korean(m.get("synonyms") or [])
            if title:
                result[str(mal_id)] = title
        if not has_next:
            break
        page += 1
        time.sleep(1)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(f"harvested {len(result)} Korean synonyms -> {output}")

if __name__ == "__main__":
    main()
