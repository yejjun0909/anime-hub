#!/usr/bin/env python3
"""국내 플랫폼 수확기들이 공유하는 유틸리티.

라프텔·쿠팡플레이·디즈니+ 수확기의 제목 인덱스 파싱, ID 생성, HTTP 재시도,
카탈로그 병합, 파일 기록 로직을 한 곳에 모읍니다. 기계 번역은 만들지 않으며,
공식 페이지에서 읽은 한국어 자료만 다룹니다.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

# Windows 콘솔의 기본 코드페이지(cp949)에서는 일부 제목을 출력할 수 없습니다.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError):
    pass

# 한글 제목 판별과 korean-title-index.js 파싱에 공통으로 쓰는 정규식입니다.
HANGUL = re.compile(r"[가-힣]")
INDEX_ENTRY_RE = re.compile(
    r'^\s*("(?:[^"\\]|\\.)*")\s*:\s*\{\s*malId:\s*(\d+),\s*anilistId:\s*"(\d+)"',
    re.M,
)

# SHA1 앞 13자리(52bit)는 JS 안전 정수 범위(2^53-1) 안에 들어옵니다.
PLATFORM_ID_HEX_DIGITS = 13
RETRY_STATUS = {403, 429, 500, 502, 503, 504}


def log(message: str) -> None:
    print(message, flush=True)


def platform_id(entity_id: str) -> int:
    """플랫폼 자체 ID를 JS 안전 정수 범위의 안정적인 정수로 변환합니다."""
    digest = hashlib.sha1(str(entity_id).encode("utf-8")).hexdigest()
    return int(digest[:PLATFORM_ID_HEX_DIGITS], 16)


def normalize_plain(value: str) -> str:
    """NFKC 정규화 + 소문자 + 문장부호/기호/공백 제거."""
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    return "".join(
        ch
        for ch in text
        if not unicodedata.category(ch).startswith(("P", "S", "Z")) and ch not in " \t\n"
    )


def clean_overview(value: str, *, strip_html: bool = False) -> str:
    """줄거리의 줄바꿈과 공백을 정리합니다. HTML 태그가 있으면 선택적으로 제거합니다."""
    text = str(value or "")
    if strip_html:
        text = text.replace("<br/>", "\n").replace("<br>", "\n")
        text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def read_platform_index(index_js: Path) -> list[tuple[str, int, int]]:
    """korean-title-index.js에서 (한국어 제목, MAL ID, AniList ID) 목록을 읽습니다."""
    entries: list[tuple[str, int, int]] = []
    if not Path(index_js).exists():
        return entries
    source = Path(index_js).read_text(encoding="utf-8")
    for raw_key, mal_id, anilist_id in INDEX_ENTRY_RE.findall(source):
        try:
            title = json.loads(raw_key)
        except json.JSONDecodeError:
            continue
        if not isinstance(title, str) or not HANGUL.search(title):
            continue
        entries.append((title, int(mal_id), int(anilist_id)))
    return entries


def fetch_with_retry(
    url: str,
    *,
    headers,
    data=None,
    retries: int = 6,
    timeout: int = 30,
    retry_status=None,
    backoff=None,
    decode_errors: str = "strict",
    parse=None,
    fail_silent: bool = False,
):
    """403/429/5xx와 일시적 네트워크 오류를 재시도하는 요청기.

    headers는 딕셔너리 또는 시도 횟수를 받아 헤더를 만드는 callable일 수 있습니다.
    data가 주어지면 POST 요청으로 전송합니다. parse가 주어지면 응답 본문에
    적용하고, 실패 시 re-parse도 재시도합니다.
    fail_silent가 True면 최종 실패 시 예외 대신 None을 돌려줍니다.
    """
    statuses = RETRY_STATUS if retry_status is None else set(retry_status)
    wait = backoff or (lambda attempt: 1.0 + attempt)

    def headers_for(attempt: int) -> dict:
        return headers(attempt) if callable(headers) else dict(headers)

    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, data=data, headers=headers_for(attempt))
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8", decode_errors)
            return parse(raw) if parse is not None else raw
        except urllib.error.HTTPError as error:
            if error.code in statuses and attempt < retries - 1:
                time.sleep(wait(attempt))
                continue
            if fail_silent:
                return None
            raise
        except (
            urllib.error.URLError,
            TimeoutError,
            http.client.HTTPException,
            OSError,
            ValueError,
        ):
            if attempt < retries - 1:
                time.sleep(wait(attempt))
                continue
            if fail_silent:
                return None
            raise
    if fail_silent:
        return None
    raise RuntimeError(f"요청 실패: {url}")


def atomic_write_json(path: Path, payload: dict) -> None:
    """임시 파일에 쓴 뒤 원자적으로 교체해 손상된 카탈로그 저장을 막습니다."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=str(target.parent)
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, target)
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def record_quality(record: dict) -> tuple:
    """중복 레코드 중 어느 쪽을 남길지 판단하는 매칭 품질 점수입니다."""
    match = str(record.get("match") or "")
    return (
        bool(record.get("year")),
        "exact-title" in match,
        "+year" in match and "±" not in match,
        record.get("kind") == "TV",
    )


def merge_platform_catalog(
    output: Path,
    platform: dict,
    new_records: list[dict],
    *,
    logger=None,
) -> dict:
    """다른 플랫폼 자료는 유지하고 해당 플랫폼 레코드만 교체한 페이로드를 만듭니다.

    platform은 {"id", "name", "priority", "sourceUrl", "checkedAt"}를 담습니다.
    """
    emit = logger or log
    preserved_records: list[dict] = []
    preserved_platforms: list[dict] = []
    if Path(output).exists():
        try:
            previous = json.loads(Path(output).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            emit(f"기존 카탈로그를 읽지 못했습니다(새로 작성): {error}")
        else:
            preserved_records = [
                record
                for record in previous.get("records", []) or []
                if isinstance(record, dict) and record.get("platform") != platform["id"]
            ]
            preserved_platforms = [
                entry
                for entry in previous.get("platforms", []) or []
                if isinstance(entry, dict) and entry.get("id") != platform["id"]
            ]
            if preserved_records or preserved_platforms:
                emit(
                    f"기존 다른 플랫폼 자료 유지: 레코드 {len(preserved_records)}건, "
                    f"플랫폼 {len(preserved_platforms)}개"
                )

    deduped: dict[tuple[str, int], dict] = {}
    for record in preserved_records + new_records:
        key = (record["platform"], record["platformId"])
        current = deduped.get(key)
        if current is None:
            deduped[key] = record
            continue
        if record_quality(record) > record_quality(current):
            deduped[key] = record

    records = list(deduped.values())
    records.sort(key=lambda record: (record["anilistId"], record["platform"]))
    platforms = sorted(
        preserved_platforms + [platform],
        key=lambda entry: (entry.get("priority", 99), str(entry.get("id") or "")),
    )
    return {
        "schemaVersion": 1,
        "region": "KR",
        "checkedAt": platform["checkedAt"],
        "platforms": platforms,
        "records": records,
    }
