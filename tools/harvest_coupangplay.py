#!/usr/bin/env python3
"""쿠팡플레이 국내 카탈로그 수확기.

한국어 제목 시드(data/korean-title-index.js)를 쿠팡플레이 공개 검색 API로
조회하고, 제목·연도·형식이 모두 일치하는 작품만
data/korean-platform-catalog.json 에 기록합니다.

중요:
  - 쿠팡플레이 검색 API가 제공하는 한국어 제목/소개를 그대로 사용합니다.
    기계 번역이나 AI 생성 결과는 만들지 않습니다.
  - 제목이 비슷하다는 이유만으로 연결하지 않습니다. 꾸밈말을 제거한 제목이
    정확히 같고, 연도 차이가 1년 이내, 애니메이션 장르이며 AniList 형식과
    쿠팡플레이 형식이 맞을 때만 채택합니다.
  - 같은 한국어 제목이 여러 작품에 붙는 경우(OVA/ONA/특별편 등)는
    형식 대조와 연도 대조로 거부합니다.
  - 결과물은 화면에서 "쿠팡플레이" 출처로 표시됩니다.

사용:
    py tools/harvest_coupangplay.py                 # 전체 수확
    py tools/harvest_coupangplay.py --limit 20      # 앞 20개만 (시험)
    py tools/harvest_coupangplay.py --dry-run       # 파일을 쓰지 않음
    py tools/harvest_coupangplay.py --debug         # 불일치 후보를 자세히 출력
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

# Windows 콘솔의 기본 코드페이지(cp949)에서는 일부 제목 문자를 출력할 수 없어
# 수확 중 UnicodeEncodeError로 종료될 수 있습니다. UTF-8로 강제합니다.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

ROOT = Path(__file__).resolve().parent.parent
INDEX_JS = ROOT / "data" / "korean-title-index.js"
ANILIST_JSON = ROOT / "data" / "anilist-catalog-harvest.json"
OUTPUT = ROOT / "data" / "korean-platform-catalog.json"

SEARCH_URL = "https://www.coupangplay.com/api-discover/v3/search"
CONTENT_PAGE = "https://www.coupangplay.com/content/{content_id}"
CHECKED_AT = date.today().isoformat()

PLATFORM_ID = "coupangplay"
PLATFORM_NAME = "쿠팡플레이"
PLATFORM_PRIORITY = 7

USER_AGENTS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
)

# 제목 앞뒤에 붙는 플랫폼 표시용 꾸밈말. 작품 제목 자체와 구분합니다.
DECORATORS = ("자막", "더빙", "무삭제", "무삭제판", "리마스터", "HD", "TV판")
DECORATOR_RE = re.compile(
    r"[\(\[]\s*(?:" + "|".join(re.escape(word) for word in DECORATORS) + r")\s*[\)\]]",
    re.I,
)
YEAR_RE = re.compile(r"^\d{4}$")
HANGUL = re.compile(r"[가-힣]")

INDEX_ENTRY_RE = re.compile(
    r'^\s*("(?:[^"\\]|\\.)*")\s*:\s*\{\s*malId:\s*(\d+),\s*anilistId:\s*"(\d+)"',
    re.M,
)

ANILIST_KIND = {
    "TV": "TV",
    "TV_SHORT": "TV",
    "MOVIE": "MOVIE",
    "OVA": "OVA",
    "ONA": "ONA",
    "SPECIAL": "SPECIAL",
}

# 쿠팡플레이의 sub_type 값. OVA/ONA/특별편은 플랫폼에서 극장판/드라마로
# 표시되는 경우가 있어 형식이 분명할 때만 연결합니다.
COUPANG_FORMATS = {
    "TV": {"TVSHOW", "TV", "TVSERIES"},
    "TV_SHORT": {"TVSHOW", "TV", "TVSERIES"},
    "MOVIE": {"MOVIE"},
    "OVA": {"OVA", "OAD"},
    "ONA": {"ONA", "WEB"},
    "SPECIAL": {"SPECIAL"},
}


def log(message: str) -> None:
    print(message, flush=True)


def normalize_plain(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    return "".join(
        ch
        for ch in text
        if not unicodedata.category(ch).startswith(("P", "S", "Z")) and ch not in " \t\n"
    )


def strip_decorators(value: str) -> str:
    """(자막)/(더빙)/(무삭제판) 같은 플랫폼 표시만 제거합니다."""
    text = DECORATOR_RE.sub(" ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def normalize_title(value: str) -> str:
    return normalize_plain(strip_decorators(value))


def get_json(url: str, retries: int = 6) -> dict:
    """간헐적인 403/429/5xx 를 고려해 재시도하는 요청기."""
    for attempt in range(retries):
        headers = {
            "User-Agent": USER_AGENTS[attempt % len(USER_AGENTS)],
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-platform": "WEBCLIENT",
            "x-app-version": "1.76.22",
            "Referer": "https://www.coupangplay.com/search",
        }
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code in {403, 429, 500, 502, 503, 504} and attempt < retries - 1:
                time.sleep(1.0 + attempt * 1.5)
                continue
            raise
        except (urllib.error.URLError, http.client.HTTPException, OSError, json.JSONDecodeError):
            if attempt < retries - 1:
                time.sleep(1.0 + attempt)
                continue
            raise
    raise RuntimeError(f"쿠팡플레이 요청 실패: {url}")


def search_coupang(keyword: str, sleep: float) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "query": keyword,
            "platform": "WEBCLIENT",
            "page": 1,
            "perPage": 20,
        }
    )
    time.sleep(sleep)
    try:
        data = get_json(f"{SEARCH_URL}?{params}")
    except Exception as error:  # noqa: BLE001
        log(f"  검색 실패({keyword}): {error}")
        return []
    contents = ((data.get("data") or {}).get("contents") or [])
    return [item for item in contents if isinstance(item, dict)]


def load_seeds() -> tuple[dict[int, dict], dict[str, tuple[int, int]], dict[str, dict]]:
    """AniList ID -> 시드, 한국어 제목 -> (MAL, AniList), AniList 메타를 읽습니다."""
    index: dict[str, tuple[int, int]] = {}
    if INDEX_JS.exists():
        for raw_key, mal_id, anilist_id in INDEX_ENTRY_RE.findall(INDEX_JS.read_text(encoding="utf-8")):
            try:
                title = json.loads(raw_key)
            except json.JSONDecodeError:
                continue
            if HANGUL.search(title):
                index[title] = (int(mal_id), int(anilist_id))

    media: dict[str, dict] = {}
    if ANILIST_JSON.exists():
        data = json.loads(ANILIST_JSON.read_text(encoding="utf-8"))
        raw_media = data.get("media") or {}
        if isinstance(raw_media, dict):
            media = {str(key): value for key, value in raw_media.items() if isinstance(value, dict)}

    seeds: dict[int, dict] = {}
    for title, (mal_id, ani_id) in index.items():
        item = media.get(str(ani_id)) or {}
        if item.get("status") == "NOT_YET_RELEASED":
            continue
        year = item.get("year")
        if not isinstance(year, int) or year <= 1900:
            continue
        seed = seeds.setdefault(
            ani_id,
            {"anilistId": ani_id, "malId": mal_id, "titles": [], "media": item},
        )
        if title not in seed["titles"]:
            seed["titles"].append(title)

    for seed in seeds.values():
        seed["titles"].sort(key=lambda title: -(media.get(str(seed["anilistId"]), {}).get("popularity") or 0))
    return seeds, index, media


def platform_year(item: dict) -> int | None:
    raw = item.get("releaseYear") or (item.get("meta") or {}).get("releaseYear")
    text = str(raw or "")
    return int(text) if YEAR_RE.fullmatch(text) else None


def format_matches(anilist: dict, item: dict) -> bool:
    ani_format = str(anilist.get("format") or "").upper()
    platform_format = str(item.get("sub_type") or item.get("as") or "").upper()
    return platform_format in COUPANG_FORMATS.get(ani_format, set())


def clean_overview(value: str) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def platform_id(content_id: str) -> int:
    """UUID를 JS 안전 정수 범위(2^53 이하)의 안정적인 정수로 변환합니다."""
    digest = hashlib.sha1(content_id.encode("utf-8")).hexdigest()
    # 15자리(60bit)는 브라우저에서 정밀도가 깨지므로 13자리(52bit)만 사용합니다.
    return int(digest[:13], 16)


def match_candidate(item: dict, candidates: list[str], anilist: dict) -> tuple[int, str] | None:
    """정확한 제목·연도·형식 검증을 통과하면 (점수, 대표 제목)을 돌려줍니다."""
    if item.get("type") != "TITLE":
        return None
    labels = {str(tag.get("label") or "") for tag in (item.get("tags") or []) if isinstance(tag, dict)}
    if "애니메이션" not in labels:
        return None
    if not format_matches(anilist, item):
        return None
    ani_year = anilist.get("year")
    p_year = platform_year(item)
    if not isinstance(ani_year, int) or not p_year or abs(ani_year - p_year) > 1:
        return None
    overview = clean_overview(item.get("description") or "")
    if len(overview) < 40 or not HANGUL.search(overview):
        return None

    platform_title = strip_decorators(item.get("title_canonical") or item.get("title") or "")
    if not platform_title or not HANGUL.search(platform_title):
        return None
    normalized = normalize_title(platform_title)
    for candidate in candidates:
        if normalized == normalize_title(candidate):
            score = 100 + (5 if ani_year == p_year else 0)
            return score, candidate
    return None


def make_record(ani: int, seed: dict, item: dict, title: str, index: dict[str, tuple[int, int]]) -> dict:
    anilist = seed["media"]
    content_id = str(item["id"])
    # 화면에는 플랫폼 표기를 제거한 공식 제목을 우선 쓰되, 검색 인덱스가
    # 같은 작품을 가리키는 제목만 사용합니다(표시/검증 일관성 유지).
    display_title = strip_decorators(item.get("title_canonical") or item.get("title") or title)
    if index.get(display_title, (None, None))[1] != ani:
        display_title = title

    p_year = platform_year(item)
    ani_year = anilist.get("year")
    match = "exact-title"
    if p_year and isinstance(ani_year, int):
        match += "+year" if p_year == ani_year else "+year±1"
    if format_matches(anilist, item):
        match += "+format"

    return {
        "workId": f"anilist-{ani}",
        "anilistId": ani,
        "malId": seed.get("malId"),
        "platform": PLATFORM_ID,
        "platformId": platform_id(content_id),
        "kind": ANILIST_KIND.get(str(anilist.get("format") or "").upper(), "TV"),
        "title": display_title,
        "overview": clean_overview(item.get("description") or ""),
        "source": PLATFORM_NAME,
        "sourceUrl": CONTENT_PAGE.format(content_id=content_id),
        "region": "KR",
        "checkedAt": CHECKED_AT,
        "status": "verified",
        "year": p_year,
        "match": match,
        "note": "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="쿠팡플레이 한국어 카탈로그 수확")
    parser.add_argument("--limit", type=int, default=0, help="처리할 작품 수 제한")
    parser.add_argument("--sleep", type=float, default=0.5, help="검색 요청 간 대기(초)")
    parser.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않음")
    parser.add_argument("--debug", action="store_true", help="불일치 후보를 자세히 출력")
    args = parser.parse_args()

    seeds, index, media = load_seeds()
    log(f"시드 작품: {len(seeds)}개 (한국어 제목 인덱스 {len(index)}개)")

    work_items = sorted(seeds.items())
    if args.limit:
        work_items = work_items[: args.limit]

    records: list[dict] = []
    stats = {"works": 0, "matched": 0, "rejected": 0, "no_result": 0}

    for position, (ani, seed) in enumerate(work_items, start=1):
        candidates = list(seed["titles"])
        if not candidates:
            continue
        stats["works"] += 1

        results: list[dict] = []
        seen_ids: set[str] = set()
        for keyword in candidates[:2]:
            for result in search_coupang(keyword, args.sleep):
                content_id = str(result.get("id") or "")
                if content_id and content_id not in seen_ids:
                    seen_ids.add(content_id)
                    results.append(result)

        if not results:
            stats["no_result"] += 1
            log(f"[{position}/{len(work_items)}] 결과 없음: {candidates[0]}")
            continue

        ranked: list[tuple[int, str, dict]] = []
        for result in results:
            matched = match_candidate(result, candidates, seed["media"])
            if matched is None:
                continue
            score, matched_title = matched
            ranked.append((score, matched_title, result))

        if not ranked:
            stats["rejected"] += 1
            log(f"[{position}/{len(work_items)}] 불일치: {candidates[0]}")
            if args.debug:
                for result in results[:5]:
                    log(
                        f"    - {result.get('id')} {result.get('title')!r} "
                        f"-> {normalize_title(result.get('title') or '')!r}"
                    )
                log(f"    후보: {[normalize_title(candidate) for candidate in candidates]}")
            continue

        ranked.sort(key=lambda pair: (-pair[0], str(pair[2].get("id") or "")))
        _score, matched_title, result = ranked[0]
        record = make_record(ani, seed, result, matched_title, index)
        records.append(record)
        stats["matched"] += 1
        log(
            f"[{position}/{len(work_items)}] OK {record['title']} -> AniList {ani} "
            f"(ID {result.get('id')})"
        )

    # 같은 쿠팡플레이 작품이 여러 AniList 항목에 연결된 경우 정확도 높은 쪽을 남깁니다.
    preserved_records: list[dict] = []
    preserved_platforms: list[dict] = []
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            log(f"기존 카탈로그를 읽지 못했습니다(새로 작성): {error}")
        else:
            preserved_records = [
                record
                for record in previous.get("records", []) or []
                if isinstance(record, dict) and record.get("platform") != PLATFORM_ID
            ]
            preserved_platforms = [
                platform
                for platform in previous.get("platforms", []) or []
                if isinstance(platform, dict) and platform.get("id") != PLATFORM_ID
            ]
            if preserved_records or preserved_platforms:
                log(
                    f"기존 다른 플랫폼 자료 유지: 레코드 {len(preserved_records)}건, "
                    f"플랫폼 {len(preserved_platforms)}개"
                )

    deduped: dict[tuple[str, int], dict] = {}
    for record in preserved_records + records:
        key = (record["platform"], record["platformId"])
        current = deduped.get(key)
        if current is None:
            deduped[key] = record
            continue
        current_score = (bool(current.get("year")), current.get("kind") == "TV")
        record_score = (bool(record.get("year")), record.get("kind") == "TV")
        if record_score > current_score:
            deduped[key] = record
    records = list(deduped.values())
    records.sort(key=lambda record: (record["anilistId"], record["platform"]))

    coupang_platform = {
        "id": PLATFORM_ID,
        "name": PLATFORM_NAME,
        "priority": PLATFORM_PRIORITY,
        "sourceUrl": "https://www.coupangplay.com/",
        "checkedAt": CHECKED_AT,
    }
    platforms = sorted(
        preserved_platforms + [coupang_platform],
        key=lambda platform: (platform.get("priority", 99), str(platform.get("id") or "")),
    )
    payload = {
        "schemaVersion": 1,
        "region": "KR",
        "checkedAt": CHECKED_AT,
        "platforms": platforms,
        "records": records,
    }

    log(
        f"완료: 작품 {stats['works']} / 일치 {stats['matched']} / "
        f"불일치 {stats['rejected']} / 결과 없음 {stats['no_result']}"
    )
    if args.dry_run:
        log("dry-run: 파일을 쓰지 않았습니다.")
        return 0

    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    log(f"작성: {OUTPUT.relative_to(ROOT)} ({len(records)}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
