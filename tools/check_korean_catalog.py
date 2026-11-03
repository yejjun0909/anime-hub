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
HANGUL = re.compile(r"[가-힣]")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

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
    if "from './data/api-vars.js'" not in app:
        fail("app.js가 data/api-vars.js를 import하지 않습니다.")
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
    for asset in ("./data/korean-catalog.js", "./data/korean-match.js", "./data/api-vars.js", "./data/schedule-merge.js", "./data/schedule-cache.js", "./data/schedule-status.js", "./data/recommend-score.js", "./data/recommend-eval.js", "./data/sync-merge.js", "./data/sync-queue.js", "./data/user-korean.js"):
        if asset not in sw:
            fail(f"sw.js SHELL에 {asset} 가 없습니다.")

    version_file = (ROOT / "VERSION.txt").read_text(encoding="utf-8")
    if app_version not in version_file:
        fail(f"VERSION.txt가 app.js 버전({app_version})과 다릅니다: {version_file.strip()!r}")


def check_generated() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "build_korean_catalog.py"), "--check"],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        fail(result.stderr.strip() or "생성 파일 검사 실패")
    if not GENERATED.exists():
        fail("data/korean-catalog.js 가 없습니다.")


def main() -> int:
    if not CATALOG.exists():
        print("실패: data/korean-catalog.json 이 없습니다.", file=sys.stderr)
        return 1
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    records = check_catalog(data)
    check_cases(records)
    check_wiring()
    check_generated()

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
