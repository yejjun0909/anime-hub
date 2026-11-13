#!/usr/bin/env python3
"""`namuEntries` 전수 재검증 도구.

수확 당시 소개가 비어 있어 검증이 약했던 항목을 나무위키 문서로 다시 확인합니다.
- 성우·배우·제작진 같은 인물 문서, 등장인물 문서, 방송 시간대 문서는 제거합니다.
- 삭제되었거나 찾을 수 없는 문서는 제거합니다.
- 작품 문서로 확인되고 한국어 소개를 새로 얻을 수 있으면 소개를 보강합니다.

사용 예:
  py tools/audit_namu_entries.py --missing-overview --dry-run
  py tools/audit_namu_entries.py --missing-overview --sleep 0.5 --save-every 50
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from harvest_namu import (  # noqa: E402
    DB_JSON,
    fetch_document,
    log,
    looks_like_character_document,
    looks_like_person_document,
    looks_like_program_block_document,
    overview_from_document,
)

STATE_JSON = Path(__file__).resolve().parent.parent / "tmp_namu_audit.json"


def load_state(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    return {"items": {}}


def save_state(path: Path, state: dict) -> None:
    path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="\n",
    )


def document_path(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return ""
    if "namu.wiki" not in parsed.netloc:
        return ""
    path = urllib.parse.unquote(parsed.path)
    return path if path.startswith("/w/") else ""


def main() -> int:
    parser = argparse.ArgumentParser(description="namuEntries 문서 재검증")
    parser.add_argument("--missing-overview", action="store_true", help="소개가 빈 항목만 검사")
    parser.add_argument("--all", action="store_true", help="모든 namuEntries 검사")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.5)
    parser.add_argument("--save-every", type=int, default=50)
    parser.add_argument("--retry-failed", action="store_true", help="이전 오류 항목 재시도")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--state", default=str(STATE_JSON))
    args = parser.parse_args()

    if not args.all and not args.missing_overview:
        parser.error("--missing-overview 또는 --all 중 하나가 필요합니다.")

    state_path = Path(args.state)
    state = load_state(state_path)
    done: dict = state.setdefault("items", {})

    db = json.loads(DB_JSON.read_text(encoding="utf-8"))
    entries = db.get("namuEntries") or {}
    targets: list[tuple[str, dict]] = []
    for key, entry in entries.items():
        if not args.all and str(entry.get("overview") or "").strip():
            continue
        if not args.retry_failed and done.get(key, {}).get("status") in {"ok", "removed"}:
            continue
        if not document_path(str(entry.get("url") or "")):
            continue
        targets.append((key, entry))
    if args.limit > 0:
        targets = targets[: args.limit]

    log(
        f"audit start: {len(targets)} entries "
        f"(mode={'all' if args.all else 'missing-overview'}, sleep={args.sleep}s)"
    )
    removed = 0
    updated = 0
    kept = 0
    failed = 0

    for index, (key, entry) in enumerate(targets, 1):
        path = document_path(str(entry.get("url") or ""))
        status = "ok"
        reason = ""
        overview = ""
        try:
            doc = fetch_document(path)
        except urllib.error.HTTPError as exc:
            status = "removed"
            reason = f"http-{exc.code}"
            doc = None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            status = "error"
            reason = str(exc)[:120]
            doc = None

        if doc is not None:
            if looks_like_person_document(doc):
                status = "removed"
                reason = "person-document"
            elif looks_like_character_document(doc):
                status = "removed"
                reason = "character-document"
            elif looks_like_program_block_document(doc):
                status = "removed"
                reason = "program-block-document"
            else:
                candidate = overview_from_document(doc)
                if candidate:
                    overview = candidate

        if status == "removed" and not args.dry_run:
            entries.pop(key, None)
            removed += 1
        elif status == "ok":
            if overview and not args.dry_run:
                entry["overview"] = overview
                updated += 1
            else:
                kept += 1
        else:
            failed += 1

        if not args.dry_run:
            done[key] = {
                "status": status,
                "reason": reason,
                "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        log(
            f"[{index}/{len(targets)}] {status} id={key} "
            f"reason={reason or '-'} overview={bool(overview)} title={entry.get('title','')}"
        )
        if index % max(1, args.save_every) == 0:
            if not args.dry_run:
                db["namuEntries"] = entries
                db["namuCount"] = len(entries)
                db["namuGeneratedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                DB_JSON.write_text(
                    json.dumps(db, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                    newline="\n",
                )
                save_state(state_path, state)
            log(f"  saved: {index}/{len(targets)}, removed={removed}, updated={updated}, kept={kept}, failed={failed}")
        if args.sleep > 0:
            time.sleep(args.sleep)

    if not args.dry_run:
        db["namuEntries"] = entries
        db["namuCount"] = len(entries)
        db["namuGeneratedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        DB_JSON.write_text(
            json.dumps(db, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )
        save_state(state_path, state)
    log(
        f"audit done: processed={len(targets)}, removed={removed}, "
        f"updated={updated}, kept={kept}, failed={failed} -> {DB_JSON}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
