#!/usr/bin/env python3
"""한국어 애니메이션 제목 DB 생성기 (v4.7+)

확인된 한국어 출처만 수집합니다.
- TMDB 한국어 번역 (토큰이 있을 때, KR 우선)
- AniList 한글 별칭(synonyms)
- MyAnimeList/Jikan 한글 대체 제목

Google Translate/Gemini 같은 기계 번역은 DB에 저장하지 않습니다.
AI는 앱에서 나무위키 검색 후보를 만들 때만 사용하며, 표시 출처가 아닙니다.

사용:
    py tools/build_korean_titles_db.py --limit 500
    py tools/build_korean_titles_db.py --limit 500 --tmdb-token YOUR_TOKEN --resume
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

ANILIST_URL = "https://graphql.anilist.co"
JIKAN_URL = "https://api.jikan.moe/v4"
TMDB_URL = "https://api.themoviedb.org/3"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ANIME-HUB-DB-Builder"
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "data" / "korean-titles-db.json"
VERIFIED_SOURCES = {"anilist", "tmdb", "mal"}


def post_json(url, payload, headers=None, timeout=30):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT, **(headers or {})},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url, headers=None, timeout=30):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def has_hangul(text):
    return any("\uAC00" <= ch <= "\uD7A3" for ch in (text or ""))


def clean_korean(text, max_length=80):
    value = " ".join(str(text or "").split())
    if not value or not has_hangul(value) or len(value) > max_length:
        return None
    return value


def fetch_anilist_page(page, per_page=50):
    query = """
    query ($page: Int!, $perPage: Int!) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: ANIME, sort: [POPULARITY_DESC]) {
          id idMal
          title { romaji english native userPreferred }
          synonyms
          description(asHtml: false)
          format status episodes seasonYear
          countryOfOrigin
        }
      }
    }
    """
    data = post_json(ANILIST_URL, {"query": query, "variables": {"page": page, "perPage": per_page}})
    page_data = (data.get("data") or {}).get("Page") or {}
    return page_data.get("media") or [], page_data.get("pageInfo", {}).get("hasNextPage", False)


def extract_anilist_korean(media):
    for synonym in media.get("synonyms") or []:
        title = clean_korean(synonym, 40)
        if title:
            return title
    return clean_korean(media.get("title", {}).get("native"), 40)


def extract_anilist_overview(media):
    description = str(media.get("description") or "")
    if has_hangul(description) and len(description) >= 20:
        return " ".join(description.split())[:500]
    return None


def tmdb_korean_title(media, tmdb_token):
    if not tmdb_token:
        return None
    title = media.get("title", {}).get("romaji") or media.get("title", {}).get("english") or ""
    if not title:
        return None
    kind = "movie" if media.get("format") == "MOVIE" else "tv"
    year = media.get("seasonYear")
    params = {"query": title, "language": "ko-KR", "include_adult": "false"}
    if year:
        params["year" if kind == "movie" else "first_air_date_year"] = str(year)
    try:
        data = get_json(
            f"{TMDB_URL}/search/{kind}?{urllib.parse.urlencode(params)}",
            headers={"Authorization": f"Bearer {tmdb_token}"},
        )
        for result in (data.get("results") or [])[:3]:
            korean = clean_korean(result.get("title") or result.get("name"), 60)
            if korean:
                return korean
    except Exception as error:
        print(f"    TMDB error: {error}")
    return None


def jikan_korean_title(mal_id):
    if not mal_id:
        return None
    try:
        data = get_json(f"{JIKAN_URL}/anime/{mal_id}/full")
        payload = data.get("data") or {}
        values = [payload.get("title_japanese"), payload.get("title_english")]
        values += [row.get("title") for row in (payload.get("titles") or [])]
        values += payload.get("title_synonyms") or []
        for value in values:
            korean = clean_korean(value, 60)
            if korean:
                return korean
    except Exception as error:
        print(f"    Jikan error: {error}")
    return None


def build_entry(media, tmdb_token):
    title = None
    source = "none"
    overview = extract_anilist_overview(media)

    # 1) TMDB 한국어 번역 (있을 때)
    title = tmdb_korean_title(media, tmdb_token)
    if title:
        source = "tmdb"

    # 2) AniList 한글 별칭
    if not title:
        title = extract_anilist_korean(media)
        if title:
            source = "anilist"

    # 3) MyAnimeList/Jikan 한글 대체 제목
    if not title:
        title = jikan_korean_title(media.get("idMal"))
        if title:
            source = "mal"

    if source not in VERIFIED_SOURCES:
        source = "none"

    confidence = {"tmdb": 0.9, "anilist": 1.0, "mal": 0.85}.get(source, 0.0)
    return {
        "anilistId": media["id"],
        "malId": media.get("idMal"),
        "title": title,
        "overview": overview,
        "source": source,
        "overviewSource": "anilist" if overview else "none",
        "confidence": confidence,
    }


def main():
    parser = argparse.ArgumentParser(description="확인된 한국어 제목 DB 생성")
    parser.add_argument("--limit", type=int, default=100, help="가져올 작품 수")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--tmdb-token", default="", help="TMDB Read Access Token")
    parser.add_argument("--resume", action="store_true", help="기존 DB에 이어서 수집")
    args = parser.parse_args()

    output_path = Path(args.output)
    db = {"version": 1, "policy": "verified-only", "generatedAt": "", "count": 0, "entries": {}}
    if (output_path.exists() and args.resume) or (output_path.exists() and not args.resume):
        try:
            db = json.loads(output_path.read_text(encoding="utf-8"))
            print(f"기존 DB 로드: {len(db.get('entries', {}))}건")
        except Exception:
            pass
    db["policy"] = "verified-only"

    entries = db.get("entries", {})
    page = 1
    collected = 0
    has_next = True
    target = max(args.limit, 1)

    print(f"목표: {target}건 수집")
    print(f"TMDB 토큰: {'있음' if args.tmdb_token else '없음'}")
    print("정책: 확인된 출처(AniList/TMDB/MAL)만 저장, 기계 번역 제외")

    while collected < target and has_next:
        print(f"\n페이지 {page} 수집 중...")
        try:
            media_list, has_next = fetch_anilist_page(page, 50)
        except Exception as error:
            print(f"  AniList 오류: {error}")
            break
        if not media_list:
            break

        for media in media_list:
            if collected >= target:
                break
            ani_id = str(media["id"])
            if ani_id in entries:
                collected += 1
                continue

            label = media.get("title", {}).get("userPreferred") or media.get("title", {}).get("romaji", "")
            print(f"  [{collected+1}/{target}] {label}")
            entry = build_entry(media, args.tmdb_token)
            entries[ani_id] = entry
            collected += 1

            if entry["title"]:
                print(f"    → {entry['title']} ({entry['source']})")
            else:
                print("    → 확인된 한국어 제목 없음")

            if collected % 10 == 0:
                db["entries"] = entries
                db["count"] = len(entries)
                db["generatedAt"] = time.strftime("%Y-%m-%d")
                output_path.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")

        page += 1
        if not has_next:
            break
        time.sleep(2)

    db["entries"] = entries
    db["count"] = len(entries)
    db["generatedAt"] = time.strftime("%Y-%m-%d")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(f"\n완료: {len(entries)}건 저장 → {output_path}")

    sources = {}
    for entry in entries.values():
        source = entry.get("source", "none")
        sources[source] = sources.get(source, 0) + 1
    print("소스별:", sources)


if __name__ == "__main__":
    main()
