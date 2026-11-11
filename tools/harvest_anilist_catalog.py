#!/usr/bin/env python3
"""AniList 애니메이션 카탈로그를 수확해 한국어 별칭 DB와 제목 매칭 자료를 보강합니다.

AniList `Page`는 `page * perPage <= 5000` 제한이 있어 인기순 100페이지(5,000작품)
이후로는 조회할 수 없습니다. 그래서 이 도구는 **연도(seasonYear)별로 분할**해
전체 연도를 훑습니다. 각 연도는 5,000작품을 넘지 않으므로 누락 없이 수집됩니다.

수집 항목:
- AniList ID, MAL ID
- 로마자/영어/원어/사용자선호 제목, 모든 별칭(synonyms)
- 시작 연도, 포맷, 상태, 인기도

용도:
1. AniList에 등록된 한국어 별칭을 `data/korean-titles-db.json`의 `entries`에
   `source: "anilist"`로 병합합니다. (이미 TMDB/MAL 등 더 강한 출처가 있는
   항목의 제목은 덮어쓰지 않습니다.)
2. `data/anilist-catalog-harvest.json`에 원본 카탈로그를 저장합니다. 이 파일은
   한국어 위키백과 수확 도구가 원어/영어 제목으로 작품을 매칭할 때 사용합니다.
   (배포 대상에서는 제외됩니다.)

정책:
- AniList 자체에 등록된 별칭만 사용합니다. 기계 번역은 만들지 않습니다.
- 연도 단위로 원본을 즉시 저장하므로 중간에 중단되어도 진행 상황이 보존됩니다.
- 429 응답은 지수 백오프로 재시도합니다.

사용:
    py tools/harvest_anilist_catalog.py
    py tools/harvest_anilist_catalog.py --year-from 1960 --year-to 2026
    py tools/harvest_anilist_catalog.py --no-merge
    py tools/harvest_anilist_catalog.py --restart
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANILIST_URL = "https://graphql.anilist.co"
RAW_OUTPUT = ROOT / "data" / "anilist-catalog-harvest.json"
DB_JSON = ROOT / "data" / "korean-titles-db.json"
USER_AGENT = "anime-hub-anilist-catalog/1.0 (https://github.com/yejjun0909/anime-hub)"
HANGUL = re.compile(r"[\uac00-\ud7a3]")
SEASON_SUFFIX = re.compile(r"(?:시즌\s*\d+|\d+기|part\s*\d+|쿨)$", re.I)

QUERY = """
query ($page: Int!, $perPage: Int!, $year: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage currentPage }
    media(type: ANIME, sort: [ID], seasonYear: $year) {
      id
      idMal
      title { romaji english native userPreferred }
      synonyms
      format
      status
      seasonYear
      popularity
      startDate { year month day }
    }
  }
}
"""

# AniList의 `seasonYear` 필터는 1940년 미만 값을 100년 뒤로 해석하는 문제가 있어
# (예: 1917 → 2017 결과) 1940년 이전 작품은 시작일 범위로 따로 수확합니다.
LEGACY_QUERY = """
query ($page: Int!, $perPage: Int!, $from: FuzzyDateInt, $to: FuzzyDateInt) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage currentPage }
    media(type: ANIME, sort: [ID], startDate_greater: $from, startDate_lesser: $to) {
      id
      idMal
      title { romaji english native userPreferred }
      synonyms
      format
      status
      seasonYear
      popularity
      startDate { year month day }
    }
  }
}
"""

HARVEST_MIN_YEAR = 1940
LEGACY_FROM = 19000101
LEGACY_TO = HARVEST_MIN_YEAR * 10000 + 101


def log(message: str) -> None:
    print(message, flush=True)


def post_json(payload: dict, retries: int = 6) -> dict | None:
    """AniList POST. 400(깊은 페이지 등)은 재시도해도 소용없으므로 None을 돌려줍니다."""
    delay = 4.0
    for attempt in range(retries):
        request = urllib.request.Request(
            ANILIST_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                data = json.loads(response.read().decode("utf-8"))
            if data.get("errors"):
                raise RuntimeError(str(data["errors"])[:300])
            return data
        except urllib.error.HTTPError as error:
            if error.code == 400:
                log(f"  AniList HTTP 400: {error.read()[:200] if error.fp else ''}")
                return None
            retry_after = error.headers.get("Retry-After") if error.headers else None
            wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
            log(f"  AniList HTTP {error.code}; {wait:.1f}초 후 재시도 ({attempt + 1}/{retries})")
            time.sleep(wait)
            delay = min(delay * 1.8, 60.0)
        except Exception as error:  # noqa: BLE001
            log(f"  AniList 오류: {error}; {delay:.1f}초 후 재시도 ({attempt + 1}/{retries})")
            time.sleep(delay)
            delay = min(delay * 1.8, 60.0)
    log("  AniList 요청 실패: 재시도를 모두 소진했습니다.")
    return None


def has_hangul(text: str) -> bool:
    return bool(HANGUL.search(text or ""))


def clean_title(value: str, max_length: int = 70) -> str | None:
    text = " ".join(str(value or "").split())
    if not text or not has_hangul(text) or len(text) > max_length:
        return None
    text = text.strip(" \t\"'`“”‘’《》<>[]()")
    if len(text) < 2:
        return None
    return text


def korean_alias_quality(value: str) -> int:
    """앱의 별칭 품질 점수와 같은 취지로 대표 제목을 고릅니다."""
    text = str(value or "").strip()
    score = 0
    if 4 <= len(text) <= 28:
        score += 5
    elif len(text) <= 36:
        score += 2
    else:
        score -= 3
    if has_hangul(text):
        score += 4
    if SEASON_SUFFIX.search(text):
        score -= 2
    if re.match(r"^(?:극장판|OVA|OAD|스페셜)\s", text):
        score -= 2
    if re.search(r"[\[\]【】]", text):
        score -= 1
    if len(text) <= 3:
        score -= 3
    return score


def best_korean_alias(media: dict) -> str | None:
    values: list[str] = []
    for synonym in media.get("synonyms") or []:
        title = clean_title(synonym)
        if title:
            values.append(title)
    native = clean_title((media.get("title") or {}).get("native"))
    if native:
        values.append(native)
    unique = list(dict.fromkeys(values))
    if not unique:
        return None
    return sorted(unique, key=lambda value: (-korean_alias_quality(value), -len(value)))[0]


def compact_media(media: dict) -> dict:
    title = media.get("title") or {}
    start = media.get("startDate") or {}
    year = media.get("seasonYear") or start.get("year")
    return {
        "id": media.get("id"),
        "idMal": media.get("idMal"),
        "title": {
            "romaji": str(title.get("romaji") or "").strip(),
            "english": str(title.get("english") or "").strip(),
            "native": str(title.get("native") or "").strip(),
            "userPreferred": str(title.get("userPreferred") or "").strip(),
        },
        "synonyms": [str(value).strip() for value in (media.get("synonyms") or []) if str(value).strip()],
        "koreanTitle": best_korean_alias(media),
        "format": media.get("format"),
        "status": media.get("status"),
        "year": int(year) if isinstance(year, int) else None,
        "popularity": int(media.get("popularity") or 0),
    }


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_raw(raw: dict, media_by_id: dict[int, dict]) -> None:
    raw["version"] = 2
    raw["generatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    raw["count"] = len(media_by_id)
    raw["media"] = {str(key): value for key, value in sorted(media_by_id.items())}
    RAW_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = RAW_OUTPUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    tmp.replace(RAW_OUTPUT)


def merge_into_db(media_by_id: dict[int, dict]) -> dict:
    db = load_json(DB_JSON, {"version": 2, "entries": {}})
    entries = db.get("entries")
    if not isinstance(entries, dict):
        entries = {}
        db["entries"] = entries

    added = 0
    filled = 0
    kept = 0
    for anilist_id, media in media_by_id.items():
        korean = media.get("koreanTitle")
        if not korean:
            continue
        key = str(anilist_id)
        entry = entries.get(key)
        if entry is None:
            entries[key] = {
                "anilistId": anilist_id,
                "malId": media.get("idMal"),
                "title": korean,
                "source": "anilist",
                "confidence": 1.0,
            }
            added += 1
            continue
        source = str(entry.get("source") or "none")
        if not entry.get("title"):
            entry["title"] = korean
            if source in {"none", ""}:
                entry["source"] = "anilist"
                entry["confidence"] = 1.0
            if entry.get("malId") is None and media.get("idMal") is not None:
                entry["malId"] = media.get("idMal")
            filled += 1
        else:
            kept += 1

    verified = 0
    for entry in entries.values():
        if entry.get("title") and str(entry.get("source") or "none") not in {"none", ""}:
            verified += 1
    db["entries"] = entries
    db["count"] = len(entries)
    db["verifiedCount"] = verified
    db["generatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    db["anilistSyncedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    DB_JSON.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    log(f"DB 병합: 신규 {added}건, 빈 제목 보강 {filled}건, 기존 유지 {kept}건")
    log(f"DB 현재: {len(entries)}건 (검증 {verified}건)")
    return db


def harvest_year(year: int, media_by_id: dict[int, dict], sleep: float, max_pages: int) -> bool:
    """한 해를 끝까지 수확합니다. 완료하면 True."""
    page = 1
    while page <= max_pages:
        data = post_json(
            {"query": QUERY, "variables": {"page": page, "perPage": 50, "year": year}}
        )
        if data is None:
            return False
        page_data = (data.get("data") or {}).get("Page") or {}
        items = page_data.get("media") or []
        for media in items:
            if isinstance(media.get("id"), int):
                media_by_id[int(media["id"])] = compact_media(media)
        if not items:
            return True
        if not bool((page_data.get("pageInfo") or {}).get("hasNextPage")):
            return True
        page += 1
        time.sleep(max(sleep, 0.6))
    log(f"  {year}년: {max_pages}페이지 한계 도달")
    return True


def harvest_legacy(media_by_id: dict[int, dict], sleep: float, max_pages: int) -> bool:
    """1940년 이전 작품을 시작일 범위로 수확합니다. 완료하면 True."""
    page = 1
    while page <= max_pages:
        data = post_json(
            {
                "query": LEGACY_QUERY,
                "variables": {
                    "page": page,
                    "perPage": 50,
                    "from": LEGACY_FROM,
                    "to": LEGACY_TO,
                },
            }
        )
        if data is None:
            return False
        page_data = (data.get("data") or {}).get("Page") or {}
        items = page_data.get("media") or []
        for media in items:
            if isinstance(media.get("id"), int):
                media_by_id[int(media["id"])] = compact_media(media)
        if not items:
            return True
        if not bool((page_data.get("pageInfo") or {}).get("hasNextPage")):
            return True
        page += 1
        time.sleep(max(sleep, 0.6))
    log(f"  1940년 이전: {max_pages}페이지 한계 도달")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="AniList 카탈로그 연도별 수확 및 한국어 별칭 병합")
    parser.add_argument("--year-from", type=int, default=HARVEST_MIN_YEAR, help="시작 연도 (1940 미만은 시작일 범위로 별도 수확)")
    parser.add_argument("--year-to", type=int, default=datetime.now().year + 1, help="끝 연도")
    parser.add_argument("--sleep", type=float, default=0.9, help="페이지 간 대기(초)")
    parser.add_argument("--max-pages-per-year", type=int, default=100, help="연도당 최대 페이지")
    parser.add_argument("--restart", action="store_true", help="기존 수확 기록을 버리고 처음부터")
    parser.add_argument("--no-merge", action="store_true", help="DB에 병합하지 않고 원본만 저장")
    parser.add_argument("--skip-legacy", action="store_true", help="1940년 이전 시작일 범위 수확을 생략")
    args = parser.parse_args()

    raw = load_json(RAW_OUTPUT, {"version": 2, "media": {}, "scannedYears": []})
    media_by_id: dict[int, dict] = {}
    for key, value in (raw.get("media") or {}).items():
        try:
            media_by_id[int(key)] = value
        except (TypeError, ValueError):
            continue
    scanned_years = set()
    if not args.restart:
        # 예전 실행에서 1940년 미만 값을 seasonYear로 보내 100년 뒤 결과를 받은
        # 기록이 있으므로, 1940년 미만은 수확 완료로 보지 않습니다.
        scanned_years = {
            int(year)
            for year in (raw.get("scannedYears") or [])
            if str(year).isdigit() and int(year) >= HARVEST_MIN_YEAR
        }
    else:
        media_by_id = {}

    years = list(range(args.year_from, args.year_to + 1))
    pending = [year for year in years if year not in scanned_years]
    log(f"수확 대상 연도: {len(years)}개 (남은 {len(pending)}개) · 기존 {len(media_by_id)}작품")

    raw.setdefault("scannedYears", [])
    for index, year in enumerate(pending, 1):
        before = len(media_by_id)
        ok = harvest_year(year, media_by_id, args.sleep, args.max_pages_per_year)
        if ok:
            scanned_years.add(year)
        raw["scannedYears"] = sorted(scanned_years)
        save_raw(raw, media_by_id)
        log(
            f"[{index}/{len(pending)}] {year}년: +{len(media_by_id) - before} · "
            f"누적 {len(media_by_id)}작품"
        )

    if not args.skip_legacy and not raw.get("legacyScanned"):
        before = len(media_by_id)
        ok = harvest_legacy(media_by_id, args.sleep, args.max_pages_per_year)
        if ok:
            raw["legacyScanned"] = True
        save_raw(raw, media_by_id)
        log(f"[1940년 이전] +{len(media_by_id) - before} · 누적 {len(media_by_id)}작품")

    korean_count = sum(1 for media in media_by_id.values() if media.get("koreanTitle"))
    log(f"원본 저장: {RAW_OUTPUT} ({len(media_by_id)}작품, 한국어 별칭 {korean_count}작품)")

    if not args.no_merge:
        merge_into_db(media_by_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
