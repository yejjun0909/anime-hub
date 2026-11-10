#!/usr/bin/env python3
"""라프텔(Laftel) 국내 카탈로그 수확기.

한국어 제목 시드(data/korean-title-index.js, data/korean-titles-db.json,
data/korean-common-titles.js)를 라프텔 검색 API로 조회하고, 제목·연도가
일치하는 작품만 data/korean-platform-catalog.json 에 기록합니다.

중요:
  - 라프텔 검색/상세 API의 응답을 그대로 사용합니다. 기계 번역을 만들지 않습니다.
  - 제목이 비슷하다는 이유만으로 연결하지 않습니다. 정규화한 제목이 같고
    (연도를 알 수 있으면) 방영 연도 차이가 1년 이내일 때만 기록합니다.
  - 결과물은 화면에서 "라프텔" 출처로 표시됩니다.

사용:
    py tools/harvest_laftel.py              # 전체 수확 (기존 시드 기준)
    py tools/harvest_laftel.py --anilist-pages 12  # AniList 인기 600작품의 한국어 별칭까지 후보로 사용
    py tools/harvest_laftel.py --limit 20   # 앞 20개만 (시험)
    py tools/harvest_laftel.py --dry-run    # 파일을 쓰지 않고 결과만 출력
    py tools/harvest_laftel.py --debug      # 제목 불일치 후보를 자세히 출력
"""

from __future__ import annotations

import argparse
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_JS = ROOT / "data" / "korean-title-index.js"
DB_JSON = ROOT / "data" / "korean-titles-db.json"
COMMON_JS = ROOT / "data" / "korean-common-titles.js"
OUTPUT = ROOT / "data" / "korean-platform-catalog.json"

ANILIST_URL = "https://graphql.anilist.co"
LAFTEL_SEARCH = "https://api.laftel.net/api/search/v3/keyword/"
LAFTEL_ITEM = "https://api.laftel.net/api/items/v1/{item_id}/"
LAFTEL_PAGE = "https://laftel.net/item/{item_id}"
USER_AGENT = "anime-hub-platform-catalog/1.0"
CHECKED_AT = date.today().isoformat()

PLATFORM_ID = "laftel"
PLATFORM_NAME = "라프텔"
PLATFORM_PRIORITY = 1

# 제목 앞뒤에 붙는 플랫폼 표시용 꾸밈말. 작품 제목 자체와 구분합니다.
DECORATORS = (
    "무삭제",
    "자막",
    "더빙",
    "리마스터",
    "합본",
    "완결",
    "TV판",
    "BD",
    "블루레이",
)
DECORATOR_SET = {word.lower() for word in DECORATORS}
PAREN_GROUP_RE = re.compile(r"[\(\[]([^\)\]]*)[\)\]]")
YEAR_RE = re.compile(r"(\d{4})\s*년")
SEASON_RE = re.compile(r"시즌\s*\d+|\d+기|part\s*\d+|쿨", re.I)
SEASON_SUFFIX_RE = re.compile(r"^(?:hd)?(?:시즌)?\d+(?:기|쿨)?$|^(?:hd)?part\d+$|^리마스터$", re.I)
HANGUL = re.compile(r"[가-힣]")

INDEX_ENTRY_RE = re.compile(
    r'^\s*("(?:[^"\\]|\\.)*")\s*:\s*\{\s*malId:\s*(\d+),\s*anilistId:\s*"(\d+)"',
    re.M,
)
COMMON_ENTRY_RE = re.compile(r"^\s*(\d+):\s*([\"'])(.*?)\2\s*,?\s*$", re.M)

ANILIST_QUERY = """
query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      idMal
      title { romaji english native }
      synonyms
      startDate { year }
      format
      episodes
      status
    }
  }
}
"""

POPULAR_QUERY = """
query ($page: Int) {
  Page(page: $page, perPage: 50) {
    media(type: ANIME, sort: POPULARITY_DESC) {
      id
      idMal
      title { romaji english native }
      synonyms
      startDate { year }
      format
      episodes
      status
    }
  }
}
"""


def log(message: str) -> None:
    print(message, flush=True)


def post_json(url: str, payload: dict, retries: int = 3) -> dict:
    for attempt in range(retries):
        request = urllib.request.Request(
            url,
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
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError("AniList 요청 실패")


def get_json(url: str, retries: int = 2) -> dict:
    for attempt in range(retries):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Origin": "https://laftel.net",
                "Referer": "https://laftel.net/",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    raise RuntimeError("라프텔 요청 실패")


def strip_decorators(value: str) -> str:
    """플랫폼이 제목 앞뒤에 붙인 (자막)/(더빙)/(무삭제) 같은 표시만 제거합니다."""

    def replace(match: re.Match[str]) -> str:
        parts = [part.strip().lower() for part in re.split(r"[,/·]", match.group(1)) if part.strip()]
        if parts and all(part in DECORATOR_SET for part in parts):
            return " "
        return match.group(0)

    text = PAREN_GROUP_RE.sub(replace, str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def normalize_plain(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    return "".join(
        ch
        for ch in text
        if not unicodedata.category(ch).startswith(("P", "S", "Z")) and ch not in " \t\n"
    )


def normalize_title(value: str) -> str:
    text = normalize_plain(strip_decorators(value))
    for word in DECORATORS:
        normalized_word = normalize_plain(word)
        if normalized_word:
            text = text.replace(normalized_word, "")
    return text


def load_seeds() -> tuple[dict[int, dict], dict[int, str]]:
    """AniList ID -> seed, MAL ID -> 한국어 제목 사전을 만듭니다."""
    seeds: dict[int, dict] = {}
    mal_titles: dict[int, str] = {}

    if INDEX_JS.exists():
        source = INDEX_JS.read_text(encoding="utf-8")
        for raw_key, mal_id, anilist_id in INDEX_ENTRY_RE.findall(source):
            title = json.loads(raw_key)
            if not HANGUL.search(title):
                continue
            ani = int(anilist_id)
            seeds.setdefault(ani, {"anilistId": ani, "malId": int(mal_id), "titles": []})
            seeds[ani]["titles"].append(title)
            mal_titles[int(mal_id)] = title

    if DB_JSON.exists():
        db = json.loads(DB_JSON.read_text(encoding="utf-8"))
        for entry in (db.get("entries") or {}).values():
            ani = entry.get("anilistId")
            title = str(entry.get("title") or "").strip()
            if not isinstance(ani, int) or not HANGUL.search(title):
                continue
            seeds.setdefault(ani, {"anilistId": ani, "malId": entry.get("malId"), "titles": []})
            seeds[ani]["titles"].append(title)
            if entry.get("malId"):
                mal_titles[int(entry["malId"])] = title

    if COMMON_JS.exists():
        for mal_id, _quote, title in COMMON_ENTRY_RE.findall(COMMON_JS.read_text(encoding="utf-8")):
            if HANGUL.search(title):
                mal_titles[int(mal_id)] = title
                # AniList ID는 아래 AniList 조회에서 MAL ID로 연결합니다.

    for seed in seeds.values():
        seed["titles"] = list(dict.fromkeys(seed["titles"]))
    return seeds, mal_titles


def fetch_popular(pages: int, sleep: float) -> dict[int, dict]:
    """AniList 인기순 작품을 가져와 한국어 별칭 시드로 확장합니다."""
    media: dict[int, dict] = {}
    for page in range(1, pages + 1):
        payload = {"query": POPULAR_QUERY, "variables": {"page": page}}
        try:
            data = post_json(ANILIST_URL, payload)
        except Exception as error:  # noqa: BLE001
            log(f"  AniList 인기 {page}페이지 실패: {error}")
            break
        items = ((data.get("data") or {}).get("Page") or {}).get("media") or []
        if not items:
            break
        for item in items:
            if isinstance(item.get("id"), int):
                media[int(item["id"])] = item
        log(f"  AniList 인기 {page}/{pages}페이지 ({len(media)}개)")
        time.sleep(max(sleep, 0.8))
    return media


def add_popular_seeds(seeds: dict[int, dict], media: dict[int, dict]) -> int:
    """인기 작품의 한국어 별칭을 수확 후보 제목으로 추가합니다."""
    added = 0
    for ani, item in media.items():
        if item.get("status") == "NOT_YET_RELEASED":
            continue
        titles = [
            str(synonym).strip()
            for synonym in (item.get("synonyms") or [])
            if HANGUL.search(str(synonym or ""))
        ]
        if not titles:
            continue
        seed = seeds.setdefault(
            ani, {"anilistId": ani, "malId": item.get("idMal"), "titles": []}
        )
        before = len(seed["titles"])
        seed["titles"] = list(dict.fromkeys(list(seed["titles"]) + titles))
        if len(seed["titles"]) > before:
            added += 1
    return added


def fetch_anilist(ids: list[int], mal_titles: dict[int, str]) -> dict[int, dict]:
    media: dict[int, dict] = {}
    for start in range(0, len(ids), 50):
        chunk = ids[start : start + 50]
        payload = {"query": ANILIST_QUERY, "variables": {"ids": chunk}}
        try:
            data = post_json(ANILIST_URL, payload)
        except Exception as error:  # noqa: BLE001
            log(f"  AniList 요청 실패({start}-{start + len(chunk) - 1}): {error}")
            time.sleep(3)
            continue
        for item in ((data.get("data") or {}).get("Page") or {}).get("media") or []:
            ani = item.get("id")
            if isinstance(ani, int):
                media[ani] = item
            mal = item.get("idMal")
            if isinstance(mal, int) and mal in mal_titles and isinstance(ani, int):
                media.setdefault(ani, item)
        log(f"  AniList {min(start + 50, len(ids))}/{len(ids)}")
        time.sleep(0.8)
    return media


def korean_titles_for(seed: dict, anilist: dict | None) -> list[str]:
    titles = list(seed.get("titles") or [])
    for synonym in (anilist or {}).get("synonyms") or []:
        if HANGUL.search(str(synonym or "")):
            titles.append(str(synonym).strip())
    return list(dict.fromkeys(title for title in titles if title))


def year_of(item: dict | None) -> int | None:
    year = ((item or {}).get("startDate") or {}).get("year")
    return int(year) if isinstance(year, int) and year > 1900 else None


def laftel_year(item: dict) -> int | None:
    quarter = str(((item.get("animation_info") or {}).get("air_year_quarter")) or "")
    match = YEAR_RE.search(quarter)
    return int(match.group(1)) if match else None


def medium_matches(format_name: str | None, medium: str | None) -> bool:
    fmt = str(format_name or "").upper()
    med = str(medium or "").upper()
    pairs = {
        "TV": {"TVA", "TV"},
        "MOVIE": {"MOVIE", "극장판"},
        "OVA": {"OVA", "OAD"},
        "ONA": {"ONA", "WEB"},
        "SPECIAL": {"SPECIAL", "스페셜"},
    }
    return med in pairs.get(fmt, set())


def search_laftel(keyword: str, sleep: float) -> list[dict]:
    params = urllib.parse.urlencode({"keyword": keyword, "viewing_only": "true"})
    time.sleep(sleep)
    try:
        data = get_json(f"{LAFTEL_SEARCH}?{params}")
    except Exception as error:  # noqa: BLE001
        log(f"  라프텔 검색 실패({keyword}): {error}")
        return []
    return [item for item in (data.get("results") or []) if isinstance(item, dict)]


def match_candidate(result: dict, candidates: list[str], anilist: dict | None) -> str | None:
    """제목이 검증된 후보와 일치하면 'exact' 또는 'season'을 돌려줍니다."""
    name = strip_decorators(result.get("name") or "")
    normalized = normalize_title(name)
    if not normalized:
        return None
    match_kind = None
    for candidate in candidates:
        candidate_key = normalize_title(candidate)
        if not candidate_key:
            continue
        if normalized == candidate_key:
            match_kind = "exact"
            break
        # "명탐정 코난 1기", "블리치 HD 2기"처럼 시즌 표기만 덧붙은 경우.
        # TV 작품에만 허용해 극장판/OVA 오매칭을 막습니다.
        if normalized.startswith(candidate_key) and SEASON_SUFFIX_RE.fullmatch(
            normalized[len(candidate_key) :]
        ):
            if medium_matches((anilist or {}).get("format"), result.get("medium")):
                match_kind = "season"
                break
    if not match_kind:
        return None
    return match_kind


def fetch_item(item_id: int, cache: dict[int, dict], sleep: float) -> dict | None:
    if item_id in cache:
        return cache[item_id]
    time.sleep(sleep)
    try:
        data = get_json(LAFTEL_ITEM.format(item_id=item_id))
    except Exception as error:  # noqa: BLE001
        log(f"  라프텔 상세 실패({item_id}): {error}")
        return None
    cache[item_id] = data
    return data


def clean_overview(value: str) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def slug(value: str, fallback: str) -> str:
    text = unicodedata.normalize("NFKC", value or "").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:60] or fallback


def main() -> int:
    parser = argparse.ArgumentParser(description="라프텔 한국어 카탈로그 수확")
    parser.add_argument("--limit", type=int, default=0, help="처리할 작품 수 제한")
    parser.add_argument("--sleep", type=float, default=0.3, help="요청 간 대기(초)")
    parser.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않음")
    parser.add_argument("--debug", action="store_true", help="불일치 후보를 자세히 출력")
    parser.add_argument(
        "--anilist-pages",
        type=int,
        default=0,
        help="AniList 인기순 N페이지(50개/페이지)의 한국어 별칭까지 수확 후보로 사용",
    )
    args = parser.parse_args()

    seeds, mal_titles = load_seeds()
    log(f"시드 작품: {len(seeds)}개 (MAL 제목 사전 {len(mal_titles)}개)")

    popular_media: dict[int, dict] = {}
    if args.anilist_pages > 0:
        popular_media = fetch_popular(args.anilist_pages, args.sleep)
        added = add_popular_seeds(seeds, popular_media)
        log(
            f"AniList 인기 {len(popular_media)}개 확인 · 한국어 별칭 시드 {added}개 추가 "
            f"(시드 {len(seeds)}개)"
        )

    # 공통 제목(MAL만 있는 항목)도 AniList ID로 연결합니다.
    mal_ids = sorted({int(mal) for mal in mal_titles})
    mal_media: dict[int, dict] = {}
    for start in range(0, len(mal_ids), 50):
        chunk = mal_ids[start : start + 50]
        payload = {
            "query": "query($ids:[Int]){Page(perPage:50){media(idMal_in:$ids,type:ANIME){id idMal title{romaji english native} synonyms startDate{year} format episodes}}}",
            "variables": {"ids": chunk},
        }
        try:
            data = post_json(ANILIST_URL, payload)
        except Exception as error:  # noqa: BLE001
            log(f"  AniList(MAL) 실패: {error}")
            continue
        for item in ((data.get("data") or {}).get("Page") or {}).get("media") or []:
            if isinstance(item.get("idMal"), int):
                mal_media[int(item["idMal"])] = item
        time.sleep(0.8)

    for mal, title in mal_titles.items():
        item = mal_media.get(mal)
        if not item or not isinstance(item.get("id"), int):
            continue
        ani = int(item["id"])
        seed = seeds.setdefault(ani, {"anilistId": ani, "malId": mal, "titles": []})
        if title not in seed["titles"]:
            seed["titles"].append(title)

    seeds = {ani: seed for ani, seed in seeds.items() if seed.get("titles")}
    log(f"시드 확장: {len(seeds)}개")

    anilist_media = fetch_anilist(sorted(seeds), mal_titles)
    for ani, item in popular_media.items():
        anilist_media.setdefault(ani, item)
    log(f"AniList 메타데이터: {len(anilist_media)}개")

    seeds = {
        ani: seed
        for ani, seed in seeds.items()
        if (anilist_media.get(ani) or {}).get("status") != "NOT_YET_RELEASED"
    }

    work_items = sorted(seeds.items())
    if args.limit:
        work_items = work_items[: args.limit]

    detail_cache: dict[int, dict] = {}
    records: list[dict] = []
    stats = {"works": 0, "matched": 0, "rejected": 0, "no_result": 0}

    for position, (ani, seed) in enumerate(work_items, start=1):
        anilist = anilist_media.get(ani) or {}
        candidates = korean_titles_for(seed, anilist)
        if not candidates:
            continue
        stats["works"] += 1

        results: list[dict] = []
        seen_ids: set[int] = set()
        for keyword in candidates[:2]:
            for result in search_laftel(keyword, args.sleep):
                item_id = result.get("id")
                if isinstance(item_id, int) and item_id not in seen_ids:
                    seen_ids.add(item_id)
                    results.append(result)

        if not results:
            stats["no_result"] += 1
            log(f"[{position}/{len(work_items)}] 결과 없음: {candidates[0]}")
            continue

        ranked: list[tuple[int, str, dict]] = []
        for result in results:
            match_kind = match_candidate(result, candidates, anilist)
            if match_kind is None:
                continue
            detail = fetch_item(int(result["id"]), detail_cache, args.sleep)
            if not detail:
                continue
            platform_year = laftel_year(detail)
            ani_year = year_of(anilist)
            if ani_year and platform_year and abs(ani_year - platform_year) > 1:
                continue
            score = 100 if match_kind == "exact" else 90
            if ani_year and platform_year and abs(ani_year - platform_year) == 0:
                score += 5
            if medium_matches(anilist.get("format"), detail.get("animation_info", {}).get("medium")):
                score += 3
            ranked.append((score, match_kind, detail))

        if not ranked:
            stats["rejected"] += 1
            log(f"[{position}/{len(work_items)}] 불일치: {candidates[0]}")
            if args.debug:
                for result in results[:5]:
                    log(f"    - {result.get('id')} {result.get('name')!r} -> {normalize_title(result.get('name') or '')!r}")
                log(f"    후보: {[normalize_title(c) for c in candidates]}")
            continue

        ranked.sort(key=lambda pair: (-pair[0], int(pair[2].get("id") or 0)))
        _, match_kind, detail = ranked[0]
        title = strip_decorators(detail.get("name") or "")
        if not title or not HANGUL.search(title):
            stats["rejected"] += 1
            continue

        overview = clean_overview(detail.get("content") or "")
        platform_year = laftel_year(detail)
        ani_format = str(anilist.get("format") or "").upper()
        kind = {
            "TV": "TV",
            "TV_SHORT": "TV",
            "MOVIE": "MOVIE",
            "OVA": "OVA",
            "ONA": "ONA",
            "SPECIAL": "SPECIAL",
        }.get(ani_format)
        if not kind:
            medium = str((detail.get("animation_info") or {}).get("medium") or "").upper()
            kind = {"TVA": "TV", "MOVIE": "MOVIE", "OVA": "OVA", "OAD": "OVA", "ONA": "ONA"}.get(
                medium, "TV"
            )

        record = {
            "workId": f"anilist-{ani}",
            "anilistId": ani,
            "malId": seed.get("malId"),
            "platform": PLATFORM_ID,
            "platformId": int(detail.get("id")),
            "kind": kind,
            "title": title,
            "overview": overview,
            "source": PLATFORM_NAME,
            "sourceUrl": LAFTEL_PAGE.format(item_id=int(detail.get("id"))),
            "region": "KR",
            "checkedAt": CHECKED_AT,
            "status": "verified",
            "year": platform_year,
            "match": (
                "exact-title"
                if match_kind == "exact"
                else "season-title"
            )
            + ("+year" if platform_year and year_of(anilist) else ""),
            "note": "",
        }
        records.append(record)
        stats["matched"] += 1
        log(f"[{position}/{len(work_items)}] OK {title} -> AniList {ani} (id {detail.get('id')})")

    # 같은 플랫폼 작품이 여러 AniList 항목에 연결된 경우(예: 미개봉 극장판),
    # 연도와 형식이 확인된 항목만 남깁니다.
    deduped: dict[tuple[str, int], dict] = {}
    for record in records:
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
    payload = {
        "schemaVersion": 1,
        "region": "KR",
        "checkedAt": CHECKED_AT,
        "platforms": [
            {
                "id": PLATFORM_ID,
                "name": PLATFORM_NAME,
                "priority": PLATFORM_PRIORITY,
                "sourceUrl": "https://laftel.net/",
                "checkedAt": CHECKED_AT,
            }
        ],
        "records": records,
    }

    log(
        f"완료: 작품 {stats['works']} / 일치 {stats['matched']} / 불일치 {stats['rejected']} / 결과 없음 {stats['no_result']}"
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
