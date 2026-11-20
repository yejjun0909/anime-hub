#!/usr/bin/env python3
"""디즈니+ KR 국내 카탈로그 수확기.

디즈니+ 공개 브라우즈 페이지에서 작품 엔티티 ID를 수집하고, 상세 JSON의
한국어 제목·소개를 AniList 카탈로그와 대조해 검증된 작품만
data/korean-platform-catalog.json 에 기록합니다.

중요:
  - 디즈니+ KR 웹은 공개 검색 API가 없습니다(enableSearch=false). 대신
    브라우즈 페이지를 순회해 엔티티를 찾고, Next.js 상세 JSON에서
    공식 한국어 메타데이터를 읽습니다.
  - 수확한 제목·소개는 디즈니+가 등록한 문장을 그대로 사용합니다.
    기계 번역이나 AI 생성 결과는 만들지 않습니다.
  - 제목이 비슷하다는 이유만으로 연결하지 않습니다. 정규화한 제목이
    정확히 같고, 연도 차이가 1년 이내, 애니메이션 장르이며 AniList 형식과
    디즈니+ 형식(Series/Movie)이 맞을 때만 채택합니다.
  - 결과물은 화면에서 "디즈니+" 출처로 표시됩니다.

사용:
    py tools/harvest_disneyplus.py                 # 전체 수확
    py tools/harvest_disneyplus.py --limit 20      # 앞 20개만 (시험)
    py tools/harvest_disneyplus.py --dry-run       # 파일을 쓰지 않음
    py tools/harvest_disneyplus.py --debug         # 불일치 후보를 자세히 출력
"""

from __future__ import annotations

import argparse
import concurrent.futures
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

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

ROOT = Path(__file__).resolve().parent.parent
INDEX_JS = ROOT / "data" / "korean-title-index.js"
ANILIST_JSON = ROOT / "data" / "anilist-catalog-harvest.json"
DETAIL_CACHE = ROOT / "data" / "disneyplus-harvest-cache.json"
OUTPUT = ROOT / "data" / "korean-platform-catalog.json"

BASE = "https://www.disneyplus.com"
HOME = f"{BASE}/ko-kr"
DETAIL_API = f"{BASE}/_next/data/{{build_id}}/ko-kr/browse/entity-{{entity_id}}.json"
DETAIL_PAGE = f"{BASE}/ko-kr/browse/entity-{{entity_id}}"
CHECKED_AT = date.today().isoformat()

PLATFORM_ID = "disneyplus"
PLATFORM_NAME = "디즈니+"
PLATFORM_PRIORITY = 8

USER_AGENTS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
)

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)
ENTITY_RE = re.compile(
    r"entity-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
)
BROWSE_PAGE_RE = re.compile(r'href="(/ko-kr/browse/page-[0-9a-f-]+)"')
YEAR_RE = re.compile(r"^(\d{4})")
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


def log(message: str) -> None:
    print(message, flush=True)


def fetch(url: str, retries: int = 7, accept: str = "application/json") -> str | None:
    """간헐적인 403/429/5xx 를 고려해 재시도하는 요청기.

    디즈니+는 짧은 시간에 많은 요청이 몰리면 403을 반환하므로, 지수 백오프와
    서로 다른 User-Agent를 번갈아 사용합니다.
    """
    for attempt in range(retries):
        headers = {
            "User-Agent": USER_AGENTS[attempt % len(USER_AGENTS)],
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            "Accept": accept,
        }
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            if error.code in {403, 429, 500, 502, 503, 504} and attempt < retries - 1:
                time.sleep(min(1.5 * (2**attempt), 20))
                continue
            return None
        except (urllib.error.URLError, TimeoutError, http.client.HTTPException, OSError):
            if attempt < retries - 1:
                time.sleep(min(1.5 * (2**attempt), 20))
                continue
            return None
    return None


def normalize_title(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = re.sub(r"\s*\|\s*디즈니\+\s*$", "", text)
    return "".join(
        ch
        for ch in text
        if not unicodedata.category(ch).startswith(("P", "S", "Z")) and ch not in " \t\n"
    )


def clean_overview(value: str) -> str:
    text = str(value or "").replace("<br/>", "\n").replace("<br>", "\n")
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def platform_id(entity_id: str) -> int:
    """엔티티 ID를 JS 안전 정수 범위(2^53 이하)의 안정적인 정수로 변환합니다."""
    digest = hashlib.sha1(entity_id.encode("utf-8")).hexdigest()
    # 15자리(60bit)는 브라우저에서 정밀도가 깨지므로 13자리(52bit)만 사용합니다.
    return int(digest[:13], 16)


def discover_entities(build_id: str, max_pages: int) -> tuple[list[str], str | None]:
    """브라우즈 페이지를 BFS로 순회해 엔티티 ID를 모읍니다."""
    html = fetch(HOME, accept="text/html,application/xhtml+xml,application/json;q=0.9")
    if not html:
        log("디즈니+ 홈 페이지를 읽지 못했습니다.")
        return [], None
    match = NEXT_DATA_RE.search(html)
    if not match:
        log("디즈니+ 홈에서 __NEXT_DATA__ 를 찾지 못했습니다.")
        return [], None
    try:
        next_data = json.loads(match.group(1))
    except json.JSONDecodeError as error:
        log(f"__NEXT_DATA__ 파싱 실패: {error}")
        return [], None
    discovered_build_id = str(next_data.get("buildId") or "") or None
    if build_id:
        discovered_build_id = build_id

    entities: set[str] = set(ENTITY_RE.findall(html))
    visited: set[str] = set()
    queue = list(dict.fromkeys(BROWSE_PAGE_RE.findall(html)))

    def scan(path: str) -> tuple[list[str], list[str]]:
        page = fetch(f"{BASE}{path}", accept="text/html,application/xhtml+xml,application/json;q=0.9") or ""
        return ENTITY_RE.findall(page), BROWSE_PAGE_RE.findall(page)

    while queue and len(visited) < max_pages:
        batch = []
        while queue and len(batch) < 12:
            path = queue.pop(0)
            if path not in visited:
                visited.add(path)
                batch.append(path)
        if not batch:
            break
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            for found_entities, found_pages in pool.map(scan, batch):
                entities.update(found_entities)
                for page_path in found_pages:
                    if page_path not in visited and page_path not in queue:
                        queue.append(page_path)
        log(f"브라우즈 {len(visited)}페이지 · 엔티티 {len(entities)}개")

    return sorted(entities), discovered_build_id


def load_index() -> tuple[dict[str, dict], dict[str, list[tuple[str, int, int]]]]:
    """AniList 메타와 정규화 제목 -> [(원제, MAL, AniList)] 인덱스를 읽습니다."""
    media: dict[str, dict] = {}
    if ANILIST_JSON.exists():
        data = json.loads(ANILIST_JSON.read_text(encoding="utf-8"))
        raw = data.get("media") or {}
        if isinstance(raw, dict):
            media = {str(key): value for key, value in raw.items() if isinstance(value, dict)}

    by_title: dict[str, list[tuple[str, int, int]]] = {}
    if INDEX_JS.exists():
        for raw_key, mal_id, anilist_id in INDEX_ENTRY_RE.findall(INDEX_JS.read_text(encoding="utf-8")):
            try:
                title = json.loads(raw_key)
            except json.JSONDecodeError:
                continue
            if not HANGUL.search(title):
                continue
            by_title.setdefault(normalize_title(title), []).append(
                (title, int(mal_id), int(anilist_id))
            )
    return media, by_title


def parse_detail(payload: str) -> dict | None:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None
    page_props = data.get("pageProps") or {}
    main = ((page_props.get("stitchDocument") or {}).get("mainContent") or [])
    hero = next(
        (item for item in main if isinstance(item, dict) and item.get("_type") == "DetailEntityHero"),
        {},
    )
    meta = next(
        (
            item
            for item in main
            if isinstance(item, dict) and item.get("title") and item.get("summary") is not None
        ),
        {},
    )
    genres = hero.get("genres") or meta.get("genres") or []
    if "애니메이션" not in {str(genre) for genre in genres}:
        return None

    ld_node = None
    for item in main:
        if isinstance(item, dict) and item.get("ldJSON"):
            graph = (item.get("ldJSON") or {}).get("@graph") or []
            ld_node = next(
                (node for node in graph if node.get("@type") not in {"BreadcrumbList", "Organization"}),
                None,
            )
            if ld_node:
                break

    hero_title = str(hero.get("title") or "").strip()
    meta_title = str(meta.get("title") or "").strip()
    title = meta_title or hero_title
    ld_type = str((ld_node or {}).get("@type") or "")
    year_match = YEAR_RE.match(str(hero.get("releaseYear") or ""))
    year = int(year_match.group(1)) if year_match else None

    overview = clean_overview(meta.get("summary") or hero.get("synopsisText") or (ld_node or {}).get("description") or "")

    episodes = 0
    for item in main:
        if isinstance(item, dict) and isinstance(item.get("episodes"), list):
            episodes = max(episodes, len(item["episodes"]))
            break

    return {
        "title": title,
        "overview": overview,
        "year": year,
        "genres": [str(genre) for genre in genres],
        "ldType": ld_type,
        "ldName": str((ld_node or {}).get("name") or ""),
        "episodes": episodes,
    }


def format_matches(anilist_format: str, ld_type: str) -> bool:
    ani = str(anilist_format or "").upper()
    if ld_type == "Movie":
        return ani in {"MOVIE"}
    if ld_type == "TVSeries":
        return ani in {"TV", "TV_SHORT", "ONA", "OVA"}
    return False


def match_detail(
    detail: dict, media: dict[str, dict], by_title: dict[str, list[tuple[str, int, int]]]
) -> tuple[int, int] | None:
    key = normalize_title(detail["title"])
    hits = by_title.get(key, [])
    if not hits:
        return None
    if len(detail["overview"]) < 40 or not HANGUL.search(detail["overview"]):
        return None

    candidates: list[tuple[int, int, str, int]] = []
    for _title, mal_id, ani_id in hits:
        item = media.get(str(ani_id)) or {}
        ani_year = item.get("year")
        if isinstance(ani_year, int) and detail["year"] and abs(ani_year - detail["year"]) > 1:
            continue
        if not format_matches(str(item.get("format") or ""), detail["ldType"]):
            continue
        score = 100
        if isinstance(ani_year, int) and detail["year"] == ani_year:
            score += 5
        candidates.append((score, mal_id, str(ani_id), item.get("popularity") or 0))
    if not candidates:
        return None
    candidates.sort(key=lambda row: (-row[0], -row[3], row[2]))
    _score, mal_id, ani_id, _pop = candidates[0]
    return mal_id, int(ani_id)


def make_record(
    entity_id: str, detail: dict, mal_id: int, ani_id: int, media: dict[str, dict]
) -> dict:
    anilist = media.get(str(ani_id)) or {}
    year_match = YEAR_RE.match(str(anilist.get("year") or ""))
    kind_year = int(year_match.group(1)) if year_match else None
    match = "exact-title"
    if detail["year"] and isinstance(kind_year, int):
        match += "+year" if detail["year"] == kind_year else "+year±1"
    match += f"+format({detail['ldType']})"

    return {
        "workId": f"anilist-{ani_id}",
        "anilistId": ani_id,
        "malId": mal_id,
        "platform": PLATFORM_ID,
        "platformId": platform_id(entity_id),
        "kind": ANILIST_KIND.get(str(anilist.get("format") or "").upper(), "TV"),
        "title": detail["title"],
        "overview": detail["overview"],
        "source": PLATFORM_NAME,
        "sourceUrl": DETAIL_PAGE.format(entity_id=entity_id),
        "region": "KR",
        "checkedAt": CHECKED_AT,
        "status": "verified",
        "year": detail["year"],
        "match": match,
        "note": "",
    }


def merge_records(new_records: list[dict]) -> list[dict]:
    """다른 플랫폼 레코드는 유지하고 디즈니+ 레코드만 교체합니다."""
    preserved: list[dict] = []
    preserved_platforms: list[dict] = []
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            log(f"기존 카탈로그를 읽지 못했습니다(새로 작성): {error}")
        else:
            preserved = [
                record
                for record in previous.get("records", []) or []
                if isinstance(record, dict) and record.get("platform") != PLATFORM_ID
            ]
            preserved_platforms = [
                platform
                for platform in previous.get("platforms", []) or []
                if isinstance(platform, dict) and platform.get("id") != PLATFORM_ID
            ]

    deduped: dict[tuple[str, int], dict] = {}
    for record in preserved + new_records:
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
    disney_platform = {
        "id": PLATFORM_ID,
        "name": PLATFORM_NAME,
        "priority": PLATFORM_PRIORITY,
        "sourceUrl": f"{BASE}/ko-kr",
        "checkedAt": CHECKED_AT,
    }
    platforms = sorted(
        preserved_platforms + [disney_platform],
        key=lambda platform: (platform.get("priority", 99), str(platform.get("id") or "")),
    )
    payload = {
        "schemaVersion": 1,
        "region": "KR",
        "checkedAt": CHECKED_AT,
        "platforms": platforms,
        "records": records,
    }
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="디즈니+ 한국어 카탈로그 수확")
    parser.add_argument("--limit", type=int, default=0, help="처리할 엔티티 수 제한")
    parser.add_argument("--pages", type=int, default=200, help="순회할 브라우즈 페이지 최대 수")
    parser.add_argument("--build-id", default="", help="고정 Next.js buildId (선택)")
    parser.add_argument("--sleep", type=float, default=0.0, help="상세 요청 간 대기(초)")
    parser.add_argument(
        "--detail-cache",
        action="store_true",
        help="이미 수집한 공식 상세 JSON 캐시를 사용합니다(디즈니+ 요청 없음)",
    )
    parser.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않음")
    parser.add_argument("--debug", action="store_true", help="매칭 실패를 자세히 출력")
    args = parser.parse_args()

    cache: dict[str, dict] = {}
    if args.detail_cache:
        if not DETAIL_CACHE.exists():
            log(f"상세 캐시 파일이 없습니다: {DETAIL_CACHE.name}")
            return 1
        cache = json.loads(DETAIL_CACHE.read_text(encoding="utf-8"))
        log(f"상세 캐시 {len(cache)}건 사용 (네트워크 상세 요청 없음)")

    if cache:
        entity_ids = sorted(cache)
        build_id = args.build_id or "cache"
    else:
        log("디즈니+ 엔티티 수집 중...")
        entity_ids, build_id = discover_entities(args.build_id, args.pages)
    if not entity_ids or not build_id:
        log("엔티티 또는 buildId를 찾지 못해 종료합니다.")
        return 1
    log(f"엔티티 {len(entity_ids)}개 · buildId {build_id}")

    if args.limit:
        entity_ids = entity_ids[: args.limit]

    media, by_title = load_index()
    log(f"AniList 메타 {len(media)}개 · 한국어 제목 인덱스 {len(by_title)}개")

    def fetch_detail(entity_id: str) -> tuple[str, dict | None]:
        if args.detail_cache:
            return entity_id, cache.get(entity_id)
        try:
            payload = fetch(DETAIL_API.format(build_id=build_id, entity_id=entity_id))
            return entity_id, parse_detail(payload) if payload else None
        except Exception as error:  # noqa: BLE001 - 개별 엔티티 실패가 전체를 중단하지 않게 합니다.
            log(f"  상세 조회 실패({entity_id[:8]}…): {type(error).__name__}")
            return entity_id, None

    records: list[dict] = []
    stats = {"scanned": 0, "anime": 0, "matched": 0, "rejected": 0, "failed": 0}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for entity_id, detail in pool.map(fetch_detail, entity_ids):
            stats["scanned"] += 1
            if args.sleep:
                time.sleep(args.sleep)
            if detail is None:
                stats["failed"] += 1
                continue
            stats["anime"] += 1
            matched = match_detail(detail, media, by_title)
            if matched is None:
                stats["rejected"] += 1
                if args.debug:
                    log(f"  불일치: {detail['title']!r} ({detail['year']}, {detail['ldType']})")
                continue
            mal_id, ani_id = matched
            records.append(make_record(entity_id, detail, mal_id, ani_id, media))
            stats["matched"] += 1
            log(
                f"OK {detail['title']} -> AniList {ani_id} "
                f"(엔티티 {entity_id[:8]}…)"
            )

    payload = merge_records(records)
    log(
        f"완료: 스캔 {stats['scanned']} / 애니메이션 {stats['anime']} / "
        f"채택 {stats['matched']} / 불일치 {stats['rejected']} / 실패 {stats['failed']}"
    )
    if args.dry_run:
        log("dry-run: 파일을 쓰지 않았습니다.")
        return 0

    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    log(f"작성: {OUTPUT.relative_to(ROOT)} ({len(payload['records'])}건)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
