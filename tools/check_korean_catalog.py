#!/usr/bin/env python3
"""한국어 카탈로그 데이터 검사 (CI + 로컬).

검사 항목:
  - data/korean-catalog.json 스키마와 값
  - data/korean-catalog.js 가 JSON과 동기화되어 있는지
  - app.js / sw.js 배선 (import, 캐시 목록, 버전)
  - 테스트 케이스가 카탈로그 전체를 커버하는지

실행: py tools/check_korean_catalog.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "data" / "korean-catalog.json"
GENERATED = ROOT / "data" / "korean-catalog.js"
PLATFORM_CATALOG = ROOT / "data" / "korean-platform-catalog.json"
PLATFORM_GENERATED = ROOT / "data" / "korean-platform-catalog.js"
TITLE_INDEX = ROOT / "data" / "korean-title-index.js"
CASES = ROOT / "tests" / "korean-id-cases.json"

REQUIRED = (
    "workId",
    "anilistId",
    "malId",
    "tmdbId",
    "kind",
    "title",
    "overview",
    "source",
    "sourceUrl",
    "region",
    "checkedAt",
    "status",
    "note",
)
ALLOWED_STATUS = {"verified", "alias", "community", "unverified"}
ALLOWED_HOSTS = {"tv.apple.com"}
PLATFORM_HOSTS = {
    "laftel": "laftel.net",
    "aniplus": "aniplus.co.kr",
    "watcha": "watcha.com",
    "tving": "tving.com",
    "wavve": "wavve.com",
    "netflix": "netflix.com",
    "coupangplay": "coupangplay.com",
    "disneyplus": "disneyplus.com",
    "apple": "tv.apple.com",
}
PLATFORM_STATUS = {"verified", "alias"}
HANGUL = re.compile(r"[가-힣]")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# 나무위키 인물(성우·배우·제작진) 문서 소개는 작품 소개가 아니므로 거부합니다.
PERSON_OVERVIEW = re.compile(
    r"^(?:일본|대한민국|한국|미국|중국)의?\s*(?:남성|여성)?\s*"
    r"(?:성우|배우|가수|만화가|작가|감독|애니메이터|일러스트레이터|"
    r"프로듀서|각본가|작곡가|음악가|방송인|코미디언|아나운서|모델|무용가|성악가)"
)

errors: list[str] = []
warnings: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def warn(message: str) -> None:
    warnings.append(message)


def check_catalog(data: dict) -> list[dict]:
    if not isinstance(data, dict):
        fail("최상위가 객체가 아닙니다.")
        return []
    if data.get("schemaVersion") != 1:
        fail(f"schemaVersion이 1이 아닙니다: {data.get('schemaVersion')!r}")
    if data.get("region") != "KR":
        fail("region이 KR이 아닙니다.")
    records = data.get("records")
    if not isinstance(records, list) or not records:
        fail("records 배열이 비어 있습니다.")
        return []
    if len(records) < 13:
        fail(f"수동 카탈로그가 13건 미만입니다: {len(records)}건")

    seen: dict[str, set] = {key: set() for key in ("workId", "anilistId", "malId")}
    title_owner: dict[str, str] = {}
    today = date.today()

    for index, record in enumerate(records):
        where = f"records[{index}]"
        if not isinstance(record, dict):
            fail(f"{where}: 객체가 아닙니다.")
            continue
        missing = [field for field in REQUIRED if field not in record]
        if missing:
            fail(f"{where}: 누락 필드 {', '.join(missing)}")
            continue
        extra = sorted(set(record) - set(REQUIRED))
        if extra:
            warn(f"{where}: 알 수 없는 필드 {', '.join(extra)}")

        work_id = record["workId"]
        if not isinstance(work_id, str) or not re.fullmatch(r"[a-z0-9-]+", work_id):
            fail(f"{where}: workId 형식 오류 {work_id!r}")
        for key in ("workId", "anilistId", "malId"):
            value = record[key]
            if value is None:
                continue
            if str(value) in seen[key]:
                fail(f"{where}: {key} 중복 {value!r}")
            seen[key].add(str(value))

        ani = record["anilistId"]
        if not isinstance(ani, int) or ani <= 0:
            fail(f"{where}: anilistId는 양의 정수여야 합니다: {ani!r}")
        mal = record["malId"]
        if mal is not None and (not isinstance(mal, int) or mal <= 0):
            fail(f"{where}: malId는 null 또는 양의 정수여야 합니다: {mal!r}")
        tmdb = record["tmdbId"]
        if tmdb is not None and (not isinstance(tmdb, int) or tmdb <= 0):
            fail(f"{where}: tmdbId는 null 또는 양의 정수여야 합니다: {tmdb!r}")

        title = record["title"]
        if not isinstance(title, str) or not HANGUL.search(title):
            fail(f"{where}: 한국어 제목이 아닙니다: {title!r}")
        if not title.strip():
            fail(f"{where}: 제목이 비어 있습니다.")
        if title in title_owner and title_owner[title] != work_id:
            warn(f"{where}: 다른 작품과 제목이 같습니다 ({title}) — 별칭 여부 확인 필요")
        title_owner[title] = work_id

        overview = record["overview"]
        if not isinstance(overview, str) or len(overview.strip()) < 40:
            fail(f"{where}: 줄거리가 40자 미만입니다 ({len(overview or '')}자)")
        if not HANGUL.search(overview or ""):
            fail(f"{where}: 줄거리에 한국어가 없습니다.")

        if record["region"] != "KR":
            fail(f"{where}: region이 KR이 아닙니다: {record['region']!r}")
        if record["status"] not in ALLOWED_STATUS:
            fail(f"{where}: status 값 오류 {record['status']!r}")
        if record["kind"] not in {"TV", "MOVIE", "OVA", "ONA", "SPECIAL"}:
            fail(f"{where}: kind 값 오류 {record['kind']!r}")

        checked = record["checkedAt"]
        if not isinstance(checked, str) or not DATE_RE.fullmatch(checked):
            fail(f"{where}: checkedAt 형식 오류 {checked!r}")
        else:
            try:
                parsed = date.fromisoformat(checked)
                if parsed > today:
                    fail(f"{where}: checkedAt가 미래입니다: {checked}")
                if (today - parsed).days > 90:
                    warn(f"{where}: checkedAt가 90일 넘게 지났습니다 ({checked})")
            except ValueError:
                fail(f"{where}: checkedAt 날짜 오류 {checked!r}")

        source = record["source"]
        if not isinstance(source, str) or len(source.strip()) < 4:
            fail(f"{where}: source가 비어 있습니다.")
        url = record["sourceUrl"]
        if not isinstance(url, str) or not url.startswith("https://"):
            fail(f"{where}: sourceUrl은 https여야 합니다: {url!r}")
        else:
            host = urlparse(url).hostname or ""
            if host not in ALLOWED_HOSTS:
                warn(f"{where}: 예상하지 못한 출처 호스트 {host}")

    return records


def check_platform_catalog(data: dict) -> list[dict]:
    """국내 플랫폼 카탈로그(data/korean-platform-catalog.json)를 검사합니다."""
    if not isinstance(data, dict):
        fail("플랫폼 카탈로그 최상위가 객체가 아닙니다.")
        return []
    if data.get("schemaVersion") != 1:
        fail(f"플랫폼 카탈로그 schemaVersion이 1이 아닙니다: {data.get('schemaVersion')!r}")
    if data.get("region") != "KR":
        fail("플랫폼 카탈로그 region이 KR이 아닙니다.")

    platforms = data.get("platforms")
    if not isinstance(platforms, list) or not platforms:
        fail("플랫폼 카탈로그 platforms 배열이 비어 있습니다.")
    else:
        seen_platforms = set()
        for index, platform in enumerate(platforms):
            if not isinstance(platform, dict):
                fail(f"platforms[{index}]: 객체가 아닙니다.")
                continue
            platform_id = platform.get("id")
            if platform_id not in PLATFORM_HOSTS:
                fail(f"platforms[{index}]: 알 수 없는 플랫폼 id {platform_id!r}")
            elif platform_id in seen_platforms:
                fail(f"platforms[{index}]: 플랫폼 id 중복 {platform_id!r}")
            seen_platforms.add(platform_id)
            priority = platform.get("priority")
            if not isinstance(priority, int) or priority <= 0:
                fail(f"platforms[{index}]: priority는 양의 정수여야 합니다: {priority!r}")

    records = data.get("records")
    if not isinstance(records, list):
        fail("플랫폼 카탈로그 records 배열이 없습니다.")
        return []
    if len(records) < 20:
        fail(f"플랫폼 카탈로그가 20건 미만입니다: {len(records)}건")

    required = (
        "workId",
        "anilistId",
        "malId",
        "platform",
        "platformId",
        "kind",
        "title",
        "overview",
        "source",
        "sourceUrl",
        "region",
        "checkedAt",
        "status",
        "year",
        "match",
        "note",
    )
    seen_pairs: set[tuple[str, int]] = set()
    seen_anilist: set[int] = set()
    today = date.today()

    for index, record in enumerate(records):
        where = f"platform records[{index}]"
        if not isinstance(record, dict):
            fail(f"{where}: 객체가 아닙니다.")
            continue
        missing = [field for field in required if field not in record]
        if missing:
            fail(f"{where}: 누락 필드 {', '.join(missing)}")
            continue

        platform = record["platform"]
        if platform not in PLATFORM_HOSTS:
            fail(f"{where}: 알 수 없는 플랫폼 {platform!r}")
            continue
        platform_id = record["platformId"]
        if not isinstance(platform_id, int) or platform_id <= 0:
            fail(f"{where}: platformId는 양의 정수여야 합니다: {platform_id!r}")
        else:
            pair = (platform, platform_id)
            if pair in seen_pairs:
                fail(f"{where}: 플랫폼 작품 중복 {pair!r}")
            seen_pairs.add(pair)

        ani = record["anilistId"]
        if not isinstance(ani, int) or ani <= 0:
            fail(f"{where}: anilistId는 양의 정수여야 합니다: {ani!r}")
        else:
            work_id = record["workId"]
            if work_id != f"anilist-{ani}":
                fail(f"{where}: workId가 anilistId와 다릅니다: {work_id!r}")
            if ani in seen_anilist:
                warn(f"{where}: 같은 AniList 작품에 플랫폼 항목이 여러 개입니다 ({ani})")
        seen_anilist.add(ani)
        mal = record["malId"]
        if mal is not None and (not isinstance(mal, int) or mal <= 0):
            fail(f"{where}: malId는 null 또는 양의 정수여야 합니다: {mal!r}")

        title = record["title"]
        if not isinstance(title, str) or not HANGUL.search(title):
            fail(f"{where}: 한국어 제목이 아닙니다: {title!r}")
        overview = record["overview"]
        if not isinstance(overview, str) or not HANGUL.search(overview):
            fail(f"{where}: 줄거리에 한국어가 없습니다.")
        if len(overview.strip()) > 4000:
            fail(f"{where}: 줄거리가 4000자를 넘습니다 ({len(overview)}자)")

        if record["region"] != "KR":
            fail(f"{where}: region이 KR이 아닙니다: {record['region']!r}")
        if record["status"] not in PLATFORM_STATUS:
            fail(f"{where}: status 값 오류 {record['status']!r}")
        if record["kind"] not in {"TV", "MOVIE", "OVA", "ONA", "SPECIAL"}:
            fail(f"{where}: kind 값 오류 {record['kind']!r}")

        year = record["year"]
        if year is not None and (not isinstance(year, int) or year < 1900 or year > today.year + 2):
            fail(f"{where}: year 값 오류 {year!r}")

        checked = record["checkedAt"]
        if not isinstance(checked, str) or not DATE_RE.fullmatch(checked):
            fail(f"{where}: checkedAt 형식 오류 {checked!r}")
        else:
            try:
                if date.fromisoformat(checked) > today:
                    fail(f"{where}: checkedAt가 미래입니다: {checked}")
            except ValueError:
                fail(f"{where}: checkedAt 날짜 오류 {checked!r}")

        source = record["source"]
        if not isinstance(source, str) or len(source.strip()) < 2:
            fail(f"{where}: source가 비어 있습니다.")
        url = record["sourceUrl"]
        if not isinstance(url, str) or not url.startswith("https://"):
            fail(f"{where}: sourceUrl은 https여야 합니다: {url!r}")
        else:
            host = urlparse(url).hostname or ""
            if host != PLATFORM_HOSTS[platform]:
                fail(f"{where}: {platform} 출처 호스트가 다릅니다: {host}")

    return records


def check_platform_title_index(records: list[dict]) -> None:
    """플랫폼 제목이 검색 인덱스에서 같은 작품을 가리키는지 확인합니다."""
    if not TITLE_INDEX.exists():
        fail("data/korean-title-index.js 가 없습니다.")
        return
    source = TITLE_INDEX.read_text(encoding="utf-8")
    pattern = re.compile(
        r'^\s*("(?:[^"\\]|\\.)*")\s*:\s*\{\s*malId:\s*(\d+),\s*anilistId:\s*"(\d+)"',
        re.M,
    )
    index: dict[str, tuple[int, int]] = {}
    for raw_key, mal_id, anilist_id in pattern.findall(source):
        try:
            key = json.loads(raw_key)
        except json.JSONDecodeError:
            continue
        index[key] = (int(mal_id), int(anilist_id))
    if not index:
        fail("검색 인덱스에서 항목을 읽지 못했습니다.")
        return
    for record in records:
        title = record["title"]
        hit = index.get(title)
        if hit is None:
            fail(f"검색 인덱스에 플랫폼 제목이 없습니다: {title!r}")
        elif hit[1] != record["anilistId"]:
            fail(
                "검색 인덱스의 플랫폼 제목이 다른 작품을 가리킵니다: "
                f"{title!r} (인덱스 {hit[1]} / 플랫폼 {record['anilistId']})"
            )


def check_cases(records: list[dict]) -> None:
    if not CASES.exists():
        fail("tests/korean-id-cases.json 이 없습니다.")
        return
    try:
        cases = json.loads(CASES.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"테스트 케이스 JSON 오류: {error}")
        return
    if not isinstance(cases, list) or len(cases) < 10:
        fail("테스트 케이스가 10개 미만입니다.")
        return

    work_ids = {record["workId"] for record in records}
    positive = set()
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            fail(f"cases[{index}]: 객체가 아닙니다.")
            continue
        for key in ("name", "media", "expectWorkId"):
            if key not in case:
                fail(f"cases[{index}]: {key} 누락")
        expected = case.get("expectWorkId")
        if expected is not None:
            positive.add(expected)
            if expected not in work_ids:
                fail(f"cases[{index}]: 알 수 없는 workId {expected!r}")
    uncovered = work_ids - positive
    if uncovered:
        fail(f"양수 매칭 케이스가 없는 작품: {', '.join(sorted(uncovered))}")


def check_wiring() -> None:
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    if "from './data/korean-match.js'" not in app:
        fail("app.js가 data/korean-match.js를 import하지 않습니다.")
    if "from './data/korean-platform-match.js'" not in app:
        fail("app.js가 data/korean-platform-match.js를 import하지 않습니다.")
    if "findKoreanPlatformRecord(" not in app:
        fail("app.js가 findKoreanPlatformRecord()를 사용하지 않습니다.")
    if "from './data/api-vars.js'" not in app:
        fail("app.js가 data/api-vars.js를 import하지 않습니다.")
    if "from './data/korean-source.js'" not in app:
        fail("app.js가 data/korean-source.js를 import하지 않습니다.")
    for direct in ("from './data/namu-search.js'", "from './data/korean-wiki.js'"):
        if direct in app:
            fail(f"app.js가 한국어 소스 모듈을 직접 import합니다: {direct}")
    if "lookupKoreanSource(" not in app:
        fail("app.js가 lookupKoreanSource()를 사용하지 않습니다.")
    for legacy in ("CURATED_KOREAN_OVERRIDES", "CURATED_KOREAN_MAL_IDS", "CURATED_KOREAN_BY_MAL"):
        if legacy in app:
            fail(f"app.js에 구버전 상수가 남아 있습니다: {legacy}")
    version = re.search(r"APP_VERSION = '([^']+)'", app)
    if not version:
        fail("app.js에서 APP_VERSION을 찾지 못했습니다.")
        return
    app_version = version.group(1)

    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    cache = re.search(r"CACHE_NAME = '([^']+)'", sw)
    if not cache:
        fail("sw.js에서 CACHE_NAME을 찾지 못했습니다.")
    else:
        expected_cache = f"anime-hub-shell-v{app_version.replace('.', '-')}"
        if cache.group(1) != expected_cache:
            fail(f"sw.js 캐시 이름이 버전과 다릅니다: {cache.group(1)} (기대: {expected_cache})")
    for asset in ("./data/korean-catalog.js", "./data/korean-match.js", "./data/korean-platform-catalog.js", "./data/korean-platform-match.js", "./data/korean-query.js", "./data/korean-source.js", "./data/korean-common-titles.js", "./data/korean-title-index.js", "./data/search-aliases.js", "./data/korean-josa.js", "./data/api-vars.js", "./data/schedule-merge.js", "./data/schedule-cache.js", "./data/schedule-status.js", "./data/recommend-score.js", "./data/recommend-eval.js", "./data/sync-merge.js", "./data/sync-queue.js", "./data/user-korean.js", "./data/machine-translate.js", "./data/gemini-translate.js", "./data/korean-titles-db.js", "./data/fuzzy-search.js", "./data/namu-search.js", "./data/korean-wiki.js"):
        if asset not in sw:
            fail(f"sw.js SHELL에 {asset} 가 없습니다.")

    db_module = (ROOT / "data" / "korean-titles-db.js").read_text(encoding="utf-8")
    for token in ("VERIFIED_KOREAN_SOURCES", "isVerifiedKoreanSource", "filterVerifiedDb", "lookupKoreanNamuTitle"):
        if token not in db_module:
            fail(f"data/korean-titles-db.js에 {token} 검증 장치가 없습니다.")

    version_file = (ROOT / "VERSION.txt").read_text(encoding="utf-8")
    if app_version not in version_file:
        fail(f"VERSION.txt가 app.js 버전({app_version})과 다릅니다: {version_file.strip()!r}")


def check_titles_db() -> None:
    """사전 계산 한국어 제목 DB의 출처/형식을 검사합니다.

    `entries`는 강한 출처(플랫폼·카탈로그·TMDB·AniList·MAL), `wikiEntries`는
    한국어 위키백과 수확분, `namuEntries`는 나무위키 수확분입니다. 수확 항목은
    반드시 한국어 제목과 해당 문서 URL을 갖고, 기계 번역 출처가 섞이면 실패합니다.
    """
    path = ROOT / "data" / "korean-titles-db.json"
    if not path.exists():
        fail("data/korean-titles-db.json 이 없습니다.")
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001
        fail(f"data/korean-titles-db.json 파싱 실패: {error}")
        return
    if not isinstance(data, dict):
        fail("korean-titles-db.json 최상위가 객체가 아닙니다.")
        return
    verified_sources = {"anilist", "tmdb", "mal", "jikan", "namu", "wiki", "catalog", "curated", "manual"}
    entries = data.get("entries") or {}
    wiki_entries = data.get("wikiEntries") or {}
    namu_entries = data.get("namuEntries") or {}
    if (
        not isinstance(entries, dict)
        or not isinstance(wiki_entries, dict)
        or not isinstance(namu_entries, dict)
    ):
        fail("korean-titles-db.json의 entries/wikiEntries/namuEntries가 객체가 아닙니다.")
        return

    for key, entry in entries.items():
        if not isinstance(entry, dict):
            fail(f"entries[{key}]가 객체가 아닙니다.")
            continue
        title = str(entry.get("title") or "").strip()
        source = str(entry.get("source") or "").strip()
        if title and source not in verified_sources:
            fail(f"entries[{key}]의 출처가 검증 목록에 없습니다: {source!r}")

    for key, entry in wiki_entries.items():
        if not isinstance(entry, dict):
            fail(f"wikiEntries[{key}]가 객체가 아닙니다.")
            continue
        title = str(entry.get("title") or "").strip()
        source = str(entry.get("source") or "").strip()
        if source != "wiki":
            fail(f"wikiEntries[{key}]의 출처는 wiki여야 합니다: {source!r}")
        if not title or not HANGUL.search(title):
            fail(f"wikiEntries[{key}]에 한국어 제목이 없습니다: {title!r}")
            continue
        if not (entry.get("anilistId") or entry.get("malId")):
            fail(f"wikiEntries[{key}]에 AniList/MAL ID가 없습니다.")
        url = str(entry.get("url") or "")
        if url and "ko.wikipedia.org/" not in url:
            fail(f"wikiEntries[{key}]의 URL이 한국어 위키백과가 아닙니다: {url}")
        overview = str(entry.get("overview") or "").strip()
        if overview and not HANGUL.search(overview):
            fail(f"wikiEntries[{key}]의 소개가 한국어가 아닙니다.")

    for key, entry in namu_entries.items():
        if not isinstance(entry, dict):
            fail(f"namuEntries[{key}]가 객체가 아닙니다.")
            continue
        title = str(entry.get("title") or "").strip()
        source = str(entry.get("source") or "").strip()
        if source != "namu":
            fail(f"namuEntries[{key}]의 출처는 namu여야 합니다: {source!r}")
        if not title or not HANGUL.search(title):
            fail(f"namuEntries[{key}]에 한국어 제목이 없습니다: {title!r}")
            continue
        if not (entry.get("anilistId") or entry.get("malId")):
            fail(f"namuEntries[{key}]에 AniList/MAL ID가 없습니다.")
        url = str(entry.get("url") or "")
        if url and "namu.wiki/" not in url:
            fail(f"namuEntries[{key}]의 URL이 나무위키가 아닙니다: {url}")
        overview = str(entry.get("overview") or "").strip()
        if overview and not HANGUL.search(overview):
            fail(f"namuEntries[{key}]의 소개가 한국어가 아닙니다.")
        if overview and PERSON_OVERVIEW.match(overview):
            fail(
                f"namuEntries[{key}]에 인물 문서 소개가 붙었습니다: "
                f"{title!r} — {overview[:40]!r}"
            )
        matched_by = str(entry.get("matchedBy") or "")
        kind = str(entry.get("kind") or "").upper()
        if matched_by.startswith("base-ko:") and kind in {"OVA", "ONA", "SPECIAL"}:
            query = matched_by.split(":", 1)[1].replace(" ", "")
            if title.replace(" ", "") == query:
                fail(
                    f"namuEntries[{key}]에 파생 작품의 프랜차이즈 대표 제목이 붙었습니다: "
                    f"{title!r} ({kind})"
                )

    if data.get("wikiCount") not in (None, len(wiki_entries)):
        warn(
            "wikiCount가 실제 wikiEntries 수와 다릅니다: "
            f"{data.get('wikiCount')} != {len(wiki_entries)}"
        )
    if data.get("namuCount") not in (None, len(namu_entries)):
        warn(
            "namuCount가 실제 namuEntries 수와 다릅니다: "
            f"{data.get('namuCount')} != {len(namu_entries)}"
        )
    print(
        f"제목 DB: entries {len(entries)}건 · wikiEntries {len(wiki_entries)}건 · "
        f"namuEntries {len(namu_entries)}건 (검증 {data.get('verifiedCount')}건)"
    )


def check_generated() -> None:
    for script in ("build_korean_catalog.py", "build_korean_platform_catalog.py"):
        result = subprocess.run(
            [sys.executable, str(ROOT / "tools" / script), "--check"],
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode != 0:
            fail(result.stderr.strip() or f"{script} 생성 파일 검사 실패")
    if not GENERATED.exists():
        fail("data/korean-catalog.js 가 없습니다.")
    if not PLATFORM_GENERATED.exists():
        fail("data/korean-platform-catalog.js 가 없습니다.")


def check_single_file() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "build_single.py"), "--check"],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        fail(result.stderr.strip() or "anime-hub-single.html 최신 상태 검사 실패")


def main() -> int:
    if not CATALOG.exists():
        print("실패: data/korean-catalog.json 이 없습니다.", file=sys.stderr)
        return 1
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    records = check_catalog(data)
    if PLATFORM_CATALOG.exists():
        platform_data = json.loads(PLATFORM_CATALOG.read_text(encoding="utf-8"))
        platform_records = check_platform_catalog(platform_data)
        check_platform_title_index(platform_records)
    else:
        fail("data/korean-platform-catalog.json 이 없습니다.")
    check_cases(records)
    check_wiring()
    check_titles_db()
    check_generated()
    check_single_file()

    for message in warnings:
        print(f"경고: {message}")
    if errors:
        for message in errors:
            print(f"실패: {message}", file=sys.stderr)
        print(f"\n{len(errors)}개 검사 실패", file=sys.stderr)
        return 1

    print(f"OK: 카탈로그 {len(records)}건, 경고 {len(warnings)}건")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
