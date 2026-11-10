#!/usr/bin/env python3
"""ANIME HUB JSON 백업 검사기.

사용:
    py tools/check_backup.py <backup.json>

복원 리허설에서 내려받은 파일이 실제로 복원 가능한 형태인지 확인합니다.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

STATUSES = {"PLANNING", "CURRENT", "COMPLETED", "PAUSED", "DROPPED"}
errors: list[str] = []
warnings: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def warn(message: str) -> None:
    warnings.append(message)


def check_watchlist(items) -> None:
    if not isinstance(items, list):
        fail("watchlist가 배열이 아닙니다.")
        return
    seen = set()
    for index, item in enumerate(items):
        where = f"watchlist[{index}]"
        if not isinstance(item, dict):
            fail(f"{where}: 객체가 아닙니다.")
            continue
        media_id = item.get("media_id")
        if media_id is None or str(media_id).strip() == "":
            fail(f"{where}: media_id가 없습니다.")
        elif str(media_id) in seen:
            fail(f"{where}: media_id 중복 {media_id!r}")
        else:
            seen.add(str(media_id))
        if item.get("status") not in STATUSES:
            fail(f"{where}: status 값 오류 {item.get('status')!r}")
        score = item.get("score")
        if score is not None and not (isinstance(score, (int, float)) and 0 <= score <= 100):
            fail(f"{where}: score 범위 오류 {score!r}")


def check_collections(items) -> None:
    if not isinstance(items, list):
        fail("collections가 배열이 아닙니다.")
        return
    seen = set()
    for index, collection in enumerate(items):
        where = f"collections[{index}]"
        if not isinstance(collection, dict):
            fail(f"{where}: 객체가 아닙니다.")
            continue
        collection_id = collection.get("id")
        if collection_id is None:
            fail(f"{where}: id가 없습니다.")
        elif str(collection_id) in seen:
            fail(f"{where}: id 중복 {collection_id!r}")
        else:
            seen.add(str(collection_id))
        if not isinstance(collection.get("name"), str) or not collection["name"].strip():
            fail(f"{where}: name이 비어 있습니다.")
        media_ids = collection.get("mediaIds", [])
        if not isinstance(media_ids, list):
            fail(f"{where}: mediaIds가 배열이 아닙니다.")
        else:
            duplicates = {str(value) for value, count in Counter(media_ids).items() if count > 1}
            if duplicates:
                warn(f"{where}: mediaIds 중복 {sorted(duplicates)}")
        items_list = collection.get("items", [])
        if not isinstance(items_list, list):
            fail(f"{where}: items가 배열이 아닙니다.")


def check_searches(items) -> None:
    if not isinstance(items, list):
        fail("savedSearches가 배열이 아닙니다.")
        return
    for index, item in enumerate(items):
        if not isinstance(item, dict) or item.get("id") is None:
            fail(f"savedSearches[{index}]: id가 없습니다.")


def check_user_korean(store) -> None:
    if store is None:
        return
    if not isinstance(store, dict):
        fail("userKorean이 객체가 아닙니다.")
        return
    for key, value in store.items():
        if not re.match(r"^[am]:\d+$", str(key)):
            fail(f"userKorean[{key!r}]: 키는 a:<AniList ID> 또는 m:<MAL ID> 형식이어야 합니다.")
            continue
        if not isinstance(value, dict):
            fail(f"userKorean[{key!r}]: 객체가 아닙니다.")
            continue
        title = value.get("title")
        overview = value.get("overview")
        if title is not None and not isinstance(title, str):
            fail(f"userKorean[{key!r}]: title이 문자열이 아닙니다.")
        if overview is not None and not isinstance(overview, str):
            fail(f"userKorean[{key!r}]: overview가 문자열이 아닙니다.")
        if not (title or overview):
            warn(f"userKorean[{key!r}]: 제목과 소개가 모두 비어 있습니다.")


def check(path: Path) -> None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"JSON 해석 실패: {error}")
        return
    if not isinstance(data, dict):
        fail("최상위가 객체가 아닙니다.")
        return
    if data.get("app") != "ANIME HUB":
        fail(f"app 값이 'ANIME HUB'가 아닙니다: {data.get('app')!r}")
    version = data.get("version")
    if not isinstance(version, str) or not version.strip():
        fail("version이 없습니다.")
    exported = data.get("exportedAt")
    if not isinstance(exported, str):
        fail("exportedAt이 없습니다.")
    else:
        try:
            datetime.fromisoformat(exported.replace("Z", "+00:00"))
        except ValueError:
            fail(f"exportedAt 형식 오류: {exported!r}")

    check_watchlist(data.get("watchlist"))
    check_collections(data.get("collections"))
    check_searches(data.get("savedSearches"))
    check_user_korean(data.get("userKorean"))

    print(f"app={data.get('app')} version={version} exportedAt={exported}")
    print(
        "보관함 {0}개 · 컬렉션 {1}개 · 저장 검색 {2}개 · 사용자 번역 {3}개".format(
            len(data.get("watchlist") or []),
            len(data.get("collections") or []),
            len(data.get("savedSearches") or []),
            len(data.get("userKorean") or {}),
        )
    )


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("사용법: py tools/check_backup.py <backup.json>", file=sys.stderr)
        return 2
    path = Path(argv[0])
    if not path.exists():
        print(f"실패: 파일이 없습니다: {path}", file=sys.stderr)
        return 2

    check(path)
    for message in warnings:
        print(f"경고: {message}")
    if errors:
        for message in errors:
            print(f"실패: {message}", file=sys.stderr)
        return 1
    print("OK: 복원 가능한 백업 형식입니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
