#!/usr/bin/env python3
"""방영 일정 데이터 스냅샷 수집기 (v4.7 사전 조사).

AniList의 7일 방영 일정을 저장하고, 지연·결방·특별편을 판별할 수 있는
필드가 실제로 존재하는지 요약합니다. 일주일간 주기적으로 실행해 비교합니다.

사용:
    py tools/schedule_probe.py
    py tools/schedule_probe.py --days 7 --out data/schedule-snapshots
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

ANILIST_URL = "https://graphql.anilist.co"
JIKAN_URL = "https://api.jikan.moe/v4"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36 ANIME-HUB-Schedule-Probe"
)
ROOT = Path(__file__).resolve().parent.parent

QUERY = """
query ScheduleProbe($page:Int!, $from:Int!, $to:Int!) {
  Page(page:$page, perPage:50) {
    pageInfo { currentPage hasNextPage total }
    airingSchedules(airingAt_greater:$from, airingAt_lesser:$to, sort:TIME) {
      id airingAt timeUntilAiring episode
      media {
        id idMal format status episodes duration
        title { userPreferred romaji native }
        nextAiringEpisode { episode airingAt }
      }
    }
  }
}
"""


def post_json(url: str, payload: dict, timeout: int = 30) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url: str, timeout: int = 30) -> dict:
    request = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_anilist(days: int, max_pages: int = 20) -> dict:
    now = datetime.now(timezone.utc)
    start = int(now.timestamp())
    end = int((now + timedelta(days=days)).timestamp())

    pages = []
    page_number = 1
    while page_number <= max_pages:
        payload = {
            "query": QUERY,
            "variables": {"page": page_number, "from": start, "to": end},
        }
        data = post_json(ANILIST_URL, payload)
        page = (data.get("data") or {}).get("Page") or {}
        rows = page.get("airingSchedules") or []
        pages.append(page)
        if not rows or not page.get("pageInfo", {}).get("hasNextPage"):
            break
        if rows[-1].get("airingAt", 0) >= end:
            break
        page_number += 1
        time.sleep(2.2)  # AniList: 30 requests/minute
    return {"pages": pages}


def all_rows(anilist: dict) -> list[dict]:
    return [row for page in anilist.get("pages", []) for row in (page.get("airingSchedules") or [])]


def fetch_jikan() -> dict | None:
    try:
        return get_json(f"{JIKAN_URL}/schedules?filter=upcoming&limit=25")
    except Exception as error:  # noqa: BLE001
        return {"error": f"{type(error).__name__}: {error}"}


def summarize_anilist(anilist: dict) -> dict:
    pages = anilist.get("pages", [])
    rows = all_rows(anilist)
    pages_info = [page.get("pageInfo", {}) for page in pages]
    gaps = [rows[i + 1]["airingAt"] - rows[i]["airingAt"] for i in range(len(rows) - 1)]
    gaps = [gap for gap in gaps if gap > 0]
    episodes = [row.get("episode") for row in rows]
    media_ids = {row.get("media", {}).get("id") for row in rows}
    formats = Counter(row.get("media", {}).get("format") or "UNKNOWN" for row in rows)
    statuses = Counter(row.get("media", {}).get("status") or "UNKNOWN" for row in rows)
    missing_episode = sum(1 for value in episodes if value is None)
    special_episode = sum(1 for value in episodes if value == 0)
    missing_duration = sum(1 for row in rows if not row.get("media", {}).get("duration"))
    missing_id_mal = sum(1 for row in rows if not row.get("media", {}).get("idMal"))
    return {
        "rows": len(rows),
        "pages": len(pages),
        "pagesWithNext": sum(1 for info in pages_info if info.get("hasNextPage")),
        "firstPageTotal": pages_info[0].get("total") if pages_info else None,
        "distinctMedia": len(media_ids),
        "formats": dict(formats),
        "statuses": dict(statuses),
        "missingEpisode": missing_episode,
        "specialEpisodeZero": special_episode,
        "missingDuration": missing_duration,
        "missingMalId": missing_id_mal,
        "medianGapMinutes": round(statistics.median(gaps) / 60, 1) if gaps else None,
        "delaySignalFields": {
            "media.nextAiringEpisode": "현재 회차만 제공, 지연 이력 없음",
            "media.status": "RELEASING/FINISHED만 제공, 결방 사유 없음",
            "airingSchedule.episode": "0 또는 누락으로 특별편 추정 가능",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--out", default=str(ROOT / "data" / "schedule-snapshots"))
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    snapshot: dict = {
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "windowDays": args.days,
        "sources": {},
    }

    try:
        anilist = fetch_anilist(args.days)
        snapshot["sources"]["anilist"] = anilist
        snapshot["summary"] = {"anilist": summarize_anilist(anilist)}
        print("AniList:", json.dumps(snapshot["summary"]["anilist"], ensure_ascii=False))
    except urllib.error.HTTPError as error:
        snapshot["sources"]["anilist"] = {"error": f"HTTP {error.code}", "body": error.read().decode("utf-8", "replace")[:500]}
        print(f"AniList 실패: HTTP {error.code}")
    except Exception as error:  # noqa: BLE001
        snapshot["sources"]["anilist"] = {"error": f"{type(error).__name__}: {error}"}
        print(f"AniList 실패: {type(error).__name__}: {error}")

    jikan = fetch_jikan()
    snapshot["sources"]["jikan"] = jikan
    if jikan and "error" not in jikan:
        rows = jikan.get("data") or []
        snapshot["summary"] = snapshot.get("summary", {})
        snapshot["summary"]["jikan"] = {
            "rows": len(rows),
            "fields": sorted(rows[0].keys()) if rows else [],
        }
        print("Jikan:", snapshot["summary"]["jikan"])
    else:
        print("Jikan 실패:", (jikan or {}).get("error", "응답 없음"))

    target = out_dir / f"schedule-{stamp}.json"
    target.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    print("저장:", target)
    return 0 if "error" not in snapshot["sources"].get("anilist", {}) else 1


if __name__ == "__main__":
    raise SystemExit(main())
