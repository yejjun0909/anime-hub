#!/usr/bin/env python3
"""한국어 애니메이션 제목 수확기 v2 (v4.9+)

개선 사항:
- Google Translate rate limit 대응 (5초 간격)
- Gemini 무료 API 지원 (API 키 있을 때)
- TMDB 한국어 번역 지원 (토큰 있을 때)
- 진행 상황 저장 (중단 후 재개 가능)
- AniList Korean synonym 수확 (무료, API 키 불필요)

사용:
    # AniList synonyms만 (무료, API 키 불필요)
    py tools/harvest_korean_titles.py --limit 500

    # Gemini 무료 API 사용 (aistudio.google.com에서 무료 키 발급)
    py tools/harvest_korean_titles.py --limit 500 --gemini-key YOUR_KEY

    # TMDB 토큰도 사용
    py tools/harvest_korean_titles.py --limit 500 --gemini-key YOUR_KEY --tmdb-token YOUR_TOKEN

    # 중단 후 재개
    py tools/harvest_korean_titles.py --limit 500 --resume
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ANILIST_URL = "https://graphql.anilist.co"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
GOOGLE_TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"
TMDB_URL = "https://api.themoviedb.org/3"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ANIME-HUB-Harvester"

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "data" / "korean-titles-db.json"


def post_json(url, payload, headers=None, timeout=30):
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT, **(headers or {})},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url, headers=None, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def has_hangul(text):
    return any("\uAC00" <= ch <= "\uD7A3" for ch in (text or ""))


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
    """AniList synonyms에서 한국어 제목 추출"""
    for syn in (media.get("synonyms") or []):
        if has_hangul(syn) and 2 <= len(syn) <= 40:
            return syn
    native = media.get("title", {}).get("native", "")
    if has_hangul(native):
        return native
    return None


def extract_anilist_overview(media):
    desc = media.get("description") or ""
    if has_hangul(desc) and len(desc) >= 20:
        return desc[:500]
    return None


def tmdb_search(title, year, tmdb_token, kind="tv"):
    """TMDB에서 한국어 제목 검색"""
    if not tmdb_token:
        return None
    try:
        params = f"query={urllib.request.quote(title)}&language=ko-KR"
        if year:
            params += f"&first_air_date_year={year}" if kind == "tv" else f"&year={year}"
        url = f"{TMDB_URL}/search/{kind}?{params}"
        data = get_json(url, headers={"Authorization": f"Bearer {tmdb_token}"})
        results = data.get("results") or []
        if not results:
            return None
        # 첫 번째 결과의 한국어 제목 확인
        r = results[0]
        title_kr = r.get("name") or r.get("title")
        if title_kr and has_hangul(title_kr):
            return title_kr
    except Exception as e:
        pass
    return None


def gemini_translate(text, api_key):
    """Gemini 무료 API로 번역"""
    if not api_key or not text:
        return None
    try:
        prompt = f"다음 일본어 텍스트를 자연스러운 한국어로 번역하세요. 애니메이션 제목일 수 있습니다. 번역 결과만 출력하세요:\n\n{text}"
        payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.3, "maxOutputTokens": 256}}
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
        data = post_json(url, payload)
        translated = (data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")).strip()
        if translated and has_hangul(translated) and translated != text:
            return translated
    except Exception as e:
        print(f"    Gemini error: {e}")
    return None


def google_translate(text):
    """Google Translate 무료 엔드포인트 (폴백, rate limit 주의)"""
    if not text:
        return None
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=ko&dt=t&q={urllib.request.quote(text)}"
        data = get_json(url)
        translated = "".join(row[0] for row in (data[0] or []) if row[0]).strip()
        if translated and has_hangul(translated) and translated != text:
            return translated
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print("    Rate limited, waiting 30s...")
            time.sleep(30)
        else:
            print(f"    Google Translate error: {e}")
    except Exception as e:
        print(f"    Google Translate error: {e}")
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="수확할 작품 수")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--gemini-key", default="", help="Gemini API 키 (무료, aistudio.google.com)")
    parser.add_argument("--tmdb-token", default="", help="TMDB Read Access Token")
    parser.add_argument("--resume", action="store_true", help="중단 후 재개")
    parser.add_argument("--skip-translate", action="store_true", help="번역 건너뛰기")
    args = parser.parse_args()

    output_path = Path(args.output)
    db = {"version": 1, "generatedAt": "", "count": 0, "entries": {}}

    if output_path.exists() or args.resume:
        try:
            db = json.loads(output_path.read_text(encoding="utf-8"))
            print(f"기존 DB 로드: {len(db.get('entries', {}))}건")
        except Exception:
            pass

    entries = db.get("entries", {})
    page = 1
    collected = 0
    target = args.limit
    has_next = True

    print(f"목표: {target}건 수확")
    print(f"Gemini 키: {'있음' if args.gemini_key else '없음'}")
    print(f"TMDB 토큰: {'있음' if args.tmdb_token else '없음'}")

    while collected < target and has_next:
        print(f"\n페이지 {page} 수확 중...")
        try:
            media_list, has_next = fetch_anilist_page(page, 50)
        except Exception as e:
            print(f"  AniList 오류: {e}")
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

            title = media.get("title", {}).get("userPreferred") or media.get("title", {}).get("romaji", "")
            print(f"  [{collected+1}/{target}] {title}")

            kr_title = None
            source = "none"

            # 1. AniList Korean synonym
            kr_title = extract_anilist_korean(media)
            if kr_title:
                source = "anilist"

            # 2. TMDB Korean translation
            if not kr_title and args.tmdb_token:
                year = media.get("seasonYear")
                kind = "movie" if media.get("format") == "MOVIE" else "tv"
                kr_title = tmdb_search(title, year, args.tmdb_token, kind)
                if kr_title:
                    source = "tmdb"

            # 3. Gemini (무료, 고품질)
            if not kr_title and args.gemini_key and not args.skip_translate:
                candidates = [media.get("title", {}).get("native"), media.get("title", {}).get("romaji")]
                for cand in candidates:
                    if cand:
                        kr_title = gemini_translate(cand, args.gemini_key)
                        if kr_title:
                            source = "gemini"
                            break
                time.sleep(4)  # Rate limit: 15 req/min

            # 4. Google Translate (폴백)
            if not kr_title and not args.skip_translate and not args.gemini_key:
                candidates = [media.get("title", {}).get("native"), media.get("title", {}).get("romaji")]
                for cand in candidates:
                    if cand:
                        kr_title = google_translate(cand)
                        if kr_title:
                            source = "google"
                            break
                time.sleep(5)  # Rate limit 회피

            # Overview
            kr_overview = extract_anilist_overview(media)
            overview_source = "anilist" if kr_overview else "none"

            entry = {
                "anilistId": media["id"],
                "malId": media.get("idMal"),
                "title": kr_title,
                "overview": kr_overview,
                "source": source,
                "overviewSource": overview_source,
                "confidence": 1.0 if source == "anilist" else 0.8 if source == "tmdb" else 0.7 if source == "gemini" else 0.4 if source == "google" else 0.0,
            }
            entries[ani_id] = entry

            if kr_title:
                print(f"    → {kr_title} ({source})")
            else:
                print(f"    → 번역 없음")

            collected += 1

            # 중간 저장 (10건마다)
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

    # 통계
    title_sources = {}
    for e in entries.values():
        s = e.get("source", "none")
        title_sources[s] = title_sources.get(s, 0) + 1
    print("제목 소스별:", title_sources)

    with_title = sum(1 for e in entries.values() if e.get("title"))
    with_overview = sum(1 for e in entries.values() if e.get("overview"))
    print(f"제목 커버리지: {with_title}/{len(entries)} ({100*with_title/len(entries):.1f}%)")
    print(f"소개 커버리지: {with_overview}/{len(entries)} ({100*with_overview/len(entries):.1f}%)")


if __name__ == "__main__":
    main()
