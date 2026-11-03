#!/usr/bin/env python3
"""한국어 애니메이션 제목 DB 생성기 (v4.9+)

AniList 상위 작품을 추출하고, TMDB/AniList/Jikan에서 한국어 제목을 찾습니다.
없는 경우 Gemini (무료) 또는 Google Translate로 번역합니다.

사용:
    py tools/build_korean_titles_db.py --limit 100 --output data/korean-titles-db.json
    py tools/build_korean_titles_db.py --limit 5000 --gemini-key YOUR_KEY

필요:
    - Gemini API 키 (무료): https://aistudio.google.com/apikey
    - 없으면 Google Translate 무료 엔드포인트 사용 (품질 낮음)
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
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ANIME-HUB-DB-Builder"

ROOT = Path(__file__).resolve().parent.parent


def post_json(url, payload, headers=None, timeout=30):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT, **(headers or {})},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


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


def has_hangul(text):
    return any("\uAC00" <= ch <= "\uD7A3" for ch in (text or ""))


def extract_anilist_korean(media):
    """AniList synonyms에서 한국어 제목 추출"""
    synonyms = media.get("synonyms") or []
    for syn in synonyms:
        if has_hangul(syn) and 2 <= len(syn) <= 40:
            return syn
    # title.native가 한글인 경우 (드물지만)
    native = media.get("title", {}).get("native", "")
    if has_hangul(native):
        return native
    return None


def gemini_translate(text, api_key, from_lang="ja", to_lang="ko"):
    """Gemini 무료 API로 번역"""
    if not api_key or not text:
        return None
    try:
        prompt = f"다음 {from_lang} 텍스트를 자연스러운 한국어로 번역하세요. 애니메이션 제목일 수 있습니다. 번역 결과만 출력하세요:\n\n{text}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 256},
        }
        url = f"{GEMINI_URL}?key={api_key}"
        data = post_json(url, payload)
        translated = (data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")).strip()
        if translated and has_hangul(translated) and translated != text:
            return translated
    except Exception as e:
        print(f"  Gemini error: {e}")
    return None


def google_translate(text, from_lang="ja", to_lang="ko"):
    """Google Translate 무료 엔드포인트 (폴백)"""
    if not text:
        return None
    try:
        url = f"{GOOGLE_TRANSLATE_URL}?client=gtx&sl={from_lang}&tl={to_lang}&dt=t&q={urllib.request.quote(text)}"
        data = get_json(url)
        translated = "".join(row[0] for row in (data[0] or []) if row[0]).strip()
        if translated and has_hangul(translated) and translated != text:
            return translated
    except Exception as e:
        print(f"  Google Translate error: {e}")
    return None


def translate_title(media, api_key=None):
    """제목 번역: AniList → Gemini → Google Translate"""
    # 1. AniList Korean synonym
    kr = extract_anilist_korean(media)
    if kr:
        return kr, "anilist"

    # 2. Gemini (무료, 고품질)
    if api_key:
        title_candidates = [media.get("title", {}).get("native"), media.get("title", {}).get("romaji"), media.get("title", {}).get("english")]
        for cand in title_candidates:
            if cand:
                result = gemini_translate(cand, api_key)
                if result:
                    return result, "gemini"
        time.sleep(4)  # Rate limit: 15 req/min

    # 3. Google Translate (폴백)
    for cand in [media.get("title", {}).get("native"), media.get("title", {}).get("romaji")]:
        if cand:
            result = google_translate(cand)
            if result:
                return result, "google"
            time.sleep(0.5)

    return None, None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="가져올 작품 수")
    parser.add_argument("--output", default=str(ROOT / "data" / "korean-titles-db.json"))
    parser.add_argument("--gemini-key", default="", help="Gemini API 키 (무료)")
    parser.add_argument("--skip-translate", action="store_true", help="번역 건너뛰기 (AniList synonyms만)")
    args = parser.parse_args()

    output_path = Path(args.output)
    db = {"version": 1, "generatedAt": "", "count": 0, "entries": {}}

    # 기존 DB 로드 (있으면)
    if output_path.exists():
        try:
            db = json.loads(output_path.read_text(encoding="utf-8"))
            print(f"기존 DB 로드: {len(db.get('entries', {}))}건")
        except Exception:
            pass

    entries = db.get("entries", {})
    page = 1
    collected = 0
    target = args.limit

    print(f"목표: {target}건 수집")
    print(f"Gemini 키: {'있음' if args.gemini_key else '없음 (Google Translate 폴백)'}")

    while collected < target:
        print(f"\n페이지 {page} 수집 중...")
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
            print(f"  [{collected+1}/{target}] {title} (AniList: {ani_id})")

            kr_title, source = translate_title(media, args.gemini_key if not args.skip_translate else None)

            entry = {
                "anilistId": media["id"],
                "malId": media.get("idMal"),
                "title": kr_title,
                "source": source or "none",
                "confidence": 1.0 if source in ("anilist",) else 0.7 if source in ("gemini",) else 0.4 if source in ("google",) else 0.0,
            }
            entries[ani_id] = entry

            if kr_title:
                print(f"    → {kr_title} ({source})")
            else:
                print(f"    → 번역 실패")

            collected += 1

        page += 1
        if not has_next:
            break
        time.sleep(2)  # AniList rate limit

    db["entries"] = entries
    db["count"] = len(entries)
    db["generatedAt"] = time.strftime("%Y-%m-%d")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print(f"\n완료: {len(entries)}건 저장 → {output_path}")

    # 통계
    sources = {}
    for e in entries.values():
        s = e.get("source", "none")
        sources[s] = sources.get(s, 0) + 1
    print("소스별:", sources)


if __name__ == "__main__":
    main()
