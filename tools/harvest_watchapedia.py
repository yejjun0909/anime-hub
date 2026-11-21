#!/usr/bin/env python3
"""왓챠피디아(pedia.watcha.com)에서 한국어 제목/소개를 수확합니다.

왓챠피디아는 검색 결과와 상세 정보(JSON-LD)를 서버에서 렌더링해 제공합니다.
이 도구는 AniList 카탈로그와 기존 한국어 DB에서 얻은 한국어 제목으로 검색하고,
상세 페이지의 JSON-LD에서 제목·줄거리·연도·장르를 읽어 아래 조건을 모두 만족할
때만 채택합니다(정밀도 우선).

  - 상세 제목이 검색 제목과 정규화 기준으로 일치(시즌 표기 'N기'는 허용)
  - datePublished 연도가 AniList 연도와 ±1년 이내
  - JSON-LD genre에 '애니메이션' 포함
  - 페이지 <title>에 상세 제목이 포함
  - 줄거리는 한국어 40자 이상일 때만 저장(없으면 제목만)

수확 결과는 `data/watchapedia-harvest.json`에 따로 저장하고, `--merge`로
`data/korean-titles-db.json`의 별도 `pediaEntries`(source `watchapedia`)에
병합합니다. 기존 `entries`/`wikiEntries`/`namuEntries`는 덮어쓰지 않습니다.
기계 번역은 만들지 않으며, 왓챠피디아에 등록된 한국어 자료만 사용합니다.

사용:
    py tools/harvest_watchapedia.py --limit 20            # 시험 수확
    py tools/harvest_watchapedia.py --resume              # 이어서 수확
    py tools/harvest_watchapedia.py --merge-only          # 저장분만 병합
    py tools/harvest_watchapedia.py --ids 101922,113415   # 지정 작품만
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANILIST_CATALOG = ROOT / "data" / "anilist-catalog-harvest.json"
DB_JSON = ROOT / "data" / "korean-titles-db.json"
DEFAULT_OUTPUT = ROOT / "data" / "watchapedia-harvest.json"

BASE = "https://pedia.watcha.com"
UA = {"User-Agent": "Mozilla/5.0"}  # 긴 Chrome UA는 403을 반환합니다.
SPACE_RE = re.compile(r"\s+")
TAG_RE = re.compile(r"<[^>]+>")
A_TAG_RE = re.compile(r"<a\s+([^>]+)>(.*?)</a>", re.S | re.I)
LD_RE = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
# 상세 헤더: 한국어 제목 · 원제 · 연도 · 제작사 · 장르 · 국가 · 관람등급
# CSS 모듈 해시(예: _1txt4_53)는 배포마다 바뀌므로 접두어만 고정합니다.
INFO_RE = re.compile(
    r'<div class="[^"]*_infoOnWallpaper_[^"]*">(.*?)</div>\s*</div>\s*</div>', re.S
)
HANGUL_RE = re.compile(r"[가-힣]")
ORIGINAL_RE = re.compile(r"[ぁ-んァ-ヶー一-龯A-Za-z]")
PERSON_OVERVIEW = re.compile(
    r"^(?:일본|대한민국|한국|미국|중국)의?\s*(?:남성|여성)?\s*"
    r"(?:성우|배우|가수|만화가|작가|감독|애니메이터|일러스트레이터|"
    r"프로듀서|각본가|작곡가|음악가|방송인|코미디언|아나운서|모델|무용가|성악가)"
)
# 검색 결과의 '2019 · Fuji TV' 형태에서 연도를 읽습니다.
SEARCH_YEAR_RE = re.compile(r"((?:19|20)\d{2})\s*·")
SEASON_RE = re.compile(r"(\d+)\s*기|시즌\s*(\d+)|season\s*(\d+)", re.I)


def log(message: str) -> None:
    print(message, flush=True)


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def clean_text(value: str) -> str:
    return SPACE_RE.sub(" ", html.unescape(TAG_RE.sub(" ", value or ""))).strip()


def has_hangul(value: str) -> bool:
    return bool(HANGUL_RE.search(str(value or "")))


def normalize_key(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower().replace("×", "x")
    return re.sub(r"[^0-9a-z가-힣]", "", text)


def original_key(value: str) -> str:
    """원제 비교용 키(일본어·영문 보존, 괄호 연도/기호 제거)."""
    text = unicodedata.normalize("NFKC", str(value or "")).lower().replace("×", "x")
    text = re.sub(r"\([^)]*\)", " ", text)
    return re.sub(r"[^0-9a-z가-힣ぁ-んァ-ヶー一-龯]", "", text)


def season_no(value: str) -> int | None:
    text = unicodedata.normalize("NFKC", str(value or ""))
    match = SEASON_RE.search(text)
    if not match:
        return None
    raw = match.group(1) or match.group(2) or match.group(3)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def base_key(value: str) -> str:
    """시즌 표기와 괄호 설명을 제거한 비교 키(1기/2기 차이만 허용할 때 사용)."""
    text = str(value or "")
    text = re.sub(r"\d+\s*기", " ", text)
    text = re.sub(r"시즌\s*\d+", " ", text, flags=re.I)
    text = re.sub(r"season\s*\d+", " ", text, flags=re.I)
    text = re.sub(r"\([^)]*\)", " ", text)
    return normalize_key(text)


def http_get(url: str, retries: int = 3, timeout: int = 25) -> str:
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8", "replace")
        except Exception as error:  # noqa: BLE001
            last_error = error
            code = getattr(error, "code", None)
            wait = 4 * (attempt + 1) if code in (403, 429) else 1.5 * (attempt + 1)
            if attempt < retries - 1:
                time.sleep(wait)
    raise last_error  # type: ignore[misc]


def search(query: str) -> list[dict]:
    url = BASE + "/ko-KR/search?query=" + urllib.parse.quote(query)
    data = http_get(url)
    results: list[dict] = []
    seen: set[str] = set()
    for match in A_TAG_RE.finditer(data):
        attrs, body = match.group(1), match.group(2)
        href = re.search(r'href="/ko/contents/([A-Za-z0-9]+)', attrs)
        if not href:
            continue
        code = href.group(1)
        if code in seen:
            continue
        title_match = re.search(r'title="([^"]*)"', attrs)
        title = html.unescape(title_match.group(1)) if title_match else clean_text(body[:240])
        year_match = SEARCH_YEAR_RE.search(body)
        year = int(year_match.group(1)) if year_match else None
        seen.add(code)
        results.append({"code": code, "title": title, "year": year})
    return results


def fetch_detail(code: str) -> dict:
    url = f"{BASE}/ko/contents/{code}"
    data = http_get(url)
    title_match = TITLE_RE.search(data)
    page_title = clean_text(title_match.group(1)) if title_match else ""
    payload = {
        "name": "",
        "description": "",
        "genres": [],
        "year": None,
        "type": "",
        "pageTitle": page_title,
        "url": url,
        "originalTitle": "",
        "infoYear": None,
        "isAnime": False,
    }
    info_match = INFO_RE.search(data)
    if info_match:
        info = SPACE_RE.sub(" ", clean_text(info_match.group(1)))
        year_match = re.search(r"((?:19|20)\d{2})\s*·", info)
        if year_match:
            payload["infoYear"] = int(year_match.group(1))
        payload["isAnime"] = "애니메이션" in info and "만화" not in info.split("·")[-1]
        # 제목(h1) 뒤, 연도 앞 구간이 원제입니다.
        h1_match = re.search(r"<h1[^>]*>(.*?)</h1>", data, re.S)
        head = clean_text(h1_match.group(1)) if h1_match else ""
        pos = info.find(head) if head else -1
        rest = info[pos + len(head) :] if pos >= 0 else info
        if year_match and rest:
            original = rest[: year_match.start()].strip()
            if original and ORIGINAL_RE.search(original):
                payload["originalTitle"] = original
    for match in LD_RE.finditer(data):
        try:
            obj = json.loads(match.group(1))
        except Exception:
            continue
        if not isinstance(obj, dict) or obj.get("@type") == "Organization":
            continue
        if not obj.get("name"):
            continue
        payload["name"] = clean_text(str(obj["name"]))
        payload["description"] = clean_text(str(obj.get("description") or ""))
        payload["genres"] = [str(item).strip() for item in (obj.get("genre") or []) if item]
        payload["type"] = str(obj.get("@type") or "")
        date_match = re.search(r"((?:19|20)\d{2})", str(obj.get("datePublished") or ""))
        if date_match:
            payload["year"] = int(date_match.group(1))
        break
    return payload


def media_titles(media: dict) -> list[str]:
    titles = media.get("title") or {}
    return [
        str(titles.get("native") or "").strip(),
        str(titles.get("romaji") or "").strip(),
        str(titles.get("english") or "").strip(),
        str(media.get("koreanTitle") or "").strip(),
    ]


def load_seed_titles(catalog: dict, db: dict) -> dict[int, str]:
    """AniList ID → 검색에 쓸 한국어 제목(나무위키 → 위키백과 → 검증 DB → AniList)."""
    seed: dict[int, str] = {}
    for section in ("namuEntries", "wikiEntries", "entries"):
        for entry in (db.get(section) or {}).values():
            if not isinstance(entry, dict):
                continue
            anilist_id = entry.get("anilistId")
            title = str(entry.get("title") or "").strip()
            if isinstance(anilist_id, int) and title and has_hangul(title):
                seed.setdefault(anilist_id, title)
    for media in (catalog.get("media") or {}).values():
        if not isinstance(media, dict):
            continue
        korean = str(media.get("koreanTitle") or "").strip()
        media_id = media.get("id")
        if isinstance(media_id, int) and korean and has_hangul(korean):
            seed.setdefault(media_id, korean)
    return seed


def load_complete(db: dict) -> dict[int, dict]:
    complete: dict[int, dict] = {}
    for section in ("entries", "wikiEntries", "namuEntries"):
        for entry in (db.get(section) or {}).values():
            if not isinstance(entry, dict):
                continue
            anilist_id = entry.get("anilistId")
            if not isinstance(anilist_id, int):
                continue
            current = complete.setdefault(anilist_id, {"overview": False})
            overview = str(entry.get("overview") or "").strip()
            if len(overview) >= 40 and has_hangul(overview):
                current["overview"] = True
    return complete


def verify(media: dict, seed_title: str, candidate: dict, detail: dict) -> dict | None:
    name = detail.get("name") or ""
    if not name or not has_hangul(name):
        return None
    exact = normalize_key(name) == normalize_key(seed_title)
    base = base_key(name) == base_key(seed_title)
    if not exact and not base:
        return None
    normalized_page = normalize_key(detail.get("pageTitle") or "")
    if normalized_page and normalize_key(name) not in normalized_page:
        return None
    # 애니메이션 장르가 JSON-LD에 없어도 헤더 장르 줄에 있는 경우가 많습니다.
    # 반대로 도서·실사 영화는 헤더에 '애니메이션'이 없으므로 여기서 걸러집니다.
    if not detail.get("isAnime") and "애니메이션" not in detail.get("genres", []):
        return None

    media_year = media.get("year")
    detail_year = (
        detail.get("year") or detail.get("infoYear") or candidate.get("year")
    )
    if isinstance(media_year, int) and isinstance(detail_year, int):
        if abs(detail_year - media_year) > 1:
            return None
    else:
        # 연도를 확인할 수 없으면 제목만으로 채택하지 않습니다.
        return None

    # 헤더의 원제(일본어/영문)가 AniList 제목과 맞는지 교차 검증합니다.
    original = str(detail.get("originalTitle") or "").strip()
    if original:
        original_norm = original_key(original)
        media_keys = [key for key in (original_key(t) for t in media_titles(media)) if len(key) >= 3]
        matched = any(
            key == original_norm
            or (len(key) >= 4 and len(original_norm) >= 4 and (original_norm in key or key in original_norm))
            for key in media_keys
        )
        if not matched:
            return None

    media_season = season_no(seed_title)
    if media_season is None:
        for title in media_titles(media):
            media_season = season_no(title)
            if media_season is not None:
                break
    detail_season = season_no(name)
    if media_season is not None and detail_season is not None and media_season != detail_season:
        return None
    if media_season is None and detail_season is not None and detail_season >= 2:
        return None
    if media_season is not None and media_season >= 2 and detail_season is None:
        return None

    description = str(detail.get("description") or "").strip()
    overview = ""
    if len(description) >= 40 and has_hangul(description):
        if not PERSON_OVERVIEW.match(description):
            overview = description

    confidence = 0.82 if exact else 0.74
    if overview:
        confidence += 0.04
    return {
        "title": name,
        "overview": overview,
        "source": "watchapedia",
        "confidence": round(min(confidence, 0.95), 2),
        "url": detail.get("url") or "",
        "matchedBy": f"ko:{seed_title}",
        "kind": str(media.get("format") or ""),
        "year": media_year,
        "detailYear": detail_year,
        "type": detail.get("type") or "",
    }


def harvest_media(media: dict, seed_title: str, sleep_seconds: float) -> dict:
    media_id = media.get("id")
    if not isinstance(media_id, int) or not seed_title:
        return {"status": "none", "reason": "no-seed"}

    # 정확 제목 우선, 연도 근접도 함께 고려해 상세 페이지는 질의마다 최대 3건 확인합니다.
    seed_key = normalize_key(seed_title)
    seed_base = base_key(seed_title)
    native = str((media.get("title") or {}).get("native") or "").strip()
    queries = [seed_title]
    if native and original_key(native) != original_key(seed_title):
        queries.append(native)  # 한국어 검색 실패 시 원제로 재검색

    def rank(item: dict) -> tuple:
        key = normalize_key(item["title"])
        item_base = base_key(item["title"])
        year = item.get("year")
        diff = abs(year - media["year"]) if isinstance(year, int) and isinstance(media.get("year"), int) else 99
        return (
            0 if key == seed_key else (1 if item_base == seed_base else 2),
            diff,
        )

    last_candidates: list[str] = []
    for query in queries:
        try:
            results = search(query)
        except Exception as error:  # noqa: BLE001
            log(f"  search fail id={media_id} query={query!r}: {error}")
            continue
        time.sleep(sleep_seconds)
        if not results:
            continue
        ranked = sorted(results, key=rank)
        last_candidates = [item["title"] for item in ranked[:3]]
        tried = 0
        for candidate in ranked:
            if tried >= 3:
                break
            if rank(candidate)[0] == 2 and tried:
                break
            tried += 1
            try:
                detail = fetch_detail(candidate["code"])
            except Exception as error:  # noqa: BLE001
                log(f"  detail fail id={media_id} code={candidate['code']}: {error}")
                time.sleep(sleep_seconds)
                continue
            time.sleep(sleep_seconds)
            verified = verify(media, seed_title, candidate, detail)
            if verified:
                verified["anilistId"] = media_id
                verified["malId"] = media.get("idMal") if isinstance(media.get("idMal"), int) else None
                verified["seedTitle"] = seed_title
                verified["searchQuery"] = query
                verified["status"] = "ok"
                return verified
    return {
        "status": "none",
        "anilistId": media_id,
        "reason": "no-verified-detail",
        "candidates": last_candidates,
    }


def select_media(args, catalog: dict, seed: dict[int, str], complete: dict[int, dict]) -> list[dict]:
    media_values = [m for m in (catalog.get("media") or {}).values() if isinstance(m, dict)]
    if args.ids:
        wanted = {int(value) for value in args.ids.split(",") if value.strip().isdigit()}
        selected = [m for m in media_values if m.get("id") in wanted]
    else:
        formats = {value.strip().upper() for value in args.formats.split(",") if value.strip()}
        minimum = max(0, args.min_popularity)
        selected = [
            m
            for m in media_values
            if (m.get("popularity") or 0) >= minimum
            and str(m.get("format") or "").upper() in formats
            and isinstance(m.get("year"), int)
            and isinstance(m.get("id"), int)
            and m.get("id") in seed
        ]
        if not args.include_known:
            selected = [m for m in selected if not complete.get(m["id"], {}).get("overview")]
        selected.sort(key=lambda m: (m.get("popularity") or 0), reverse=True)
    if args.offset:
        selected = selected[args.offset :]
    if args.limit:
        selected = selected[: args.limit]
    return selected


def save_output(path: Path, payload: dict) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="\n",
    )


def merge_into_db(items: dict[str, dict], dry_run: bool = False) -> dict:
    db = load_json(DB_JSON, {"version": 2, "entries": {}, "wikiEntries": {}})
    pedia_entries = db.get("pediaEntries")
    if not isinstance(pedia_entries, dict):
        pedia_entries = {}
        db["pediaEntries"] = pedia_entries
    added = updated = kept = pruned = 0
    # 인물 문서 소개가 남아 있으면 병합 시에도 제거합니다.
    for key in list(pedia_entries):
        existing = pedia_entries.get(key)
        if isinstance(existing, dict) and PERSON_OVERVIEW.match(
            str(existing.get("overview") or "")
        ):
            del pedia_entries[key]
            pruned += 1
    for item in items.values():
        if item.get("status") != "ok":
            continue
        title = str(item.get("title") or "").strip()
        if not title or not has_hangul(title):
            continue
        anilist_id = item.get("anilistId")
        mal_id = item.get("malId")
        if not (isinstance(anilist_id, int) or isinstance(mal_id, int)):
            continue
        key = str(anilist_id) if isinstance(anilist_id, int) else f"mal:{mal_id}"
        overview = str(item.get("overview") or "").strip()
        if overview and not has_hangul(overview):
            overview = ""
        if PERSON_OVERVIEW.match(overview):
            continue
        url = str(item.get("url") or "").strip()
        if url and "pedia.watcha.com/" not in url:
            continue
        entry = {
            "anilistId": anilist_id,
            "malId": mal_id,
            "title": title,
            "overview": overview,
            "source": "watchapedia",
            "confidence": float(item.get("confidence") or 0.7),
            "url": url,
            "matchedBy": str(item.get("matchedBy") or "").strip(),
            "kind": str(item.get("kind") or "").strip(),
        }
        existing = pedia_entries.get(key)
        if existing is None:
            pedia_entries[key] = entry
            added += 1
            continue
        old_overview = bool(str(existing.get("overview") or "").strip())
        new_overview = bool(overview)
        if new_overview and not old_overview:
            pedia_entries[key] = entry
            updated += 1
        elif float(item.get("confidence") or 0) > float(existing.get("confidence") or 0):
            pedia_entries[key] = entry
            updated += 1
        else:
            kept += 1
    db["pediaEntries"] = pedia_entries
    db["pediaCount"] = len(pedia_entries)
    db["pediaGeneratedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not dry_run:
        DB_JSON.write_text(
            json.dumps(db, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )
    log(
        f"pediaEntries merge: added {added}, updated {updated}, kept {kept}, "
        f"pruned {pruned}, total {len(pedia_entries)}"
    )
    return db


def main() -> int:
    parser = argparse.ArgumentParser(description="왓챠피디아 애니메이션 한국어 제목/소개 수확")
    parser.add_argument("--min-popularity", type=int, default=5000)
    parser.add_argument("--formats", default="TV,TV_SHORT,MOVIE")
    parser.add_argument("--limit", type=int, default=0, help="0이면 전체")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--ids", default="", help="쉼표로 구분한 AniList ID")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--retry-none", action="store_true")
    parser.add_argument("--sleep", type=float, default=0.8)
    parser.add_argument("--save-every", type=int, default=20)
    parser.add_argument("--no-merge", action="store_true")
    parser.add_argument("--merge-only", action="store_true")
    parser.add_argument(
        "--include-known",
        action="store_true",
        help="이미 한국어 소개가 있는 작품도 다시 수확합니다.",
    )
    args = parser.parse_args()

    output_path = Path(args.output)
    catalog = load_json(ANILIST_CATALOG, {})
    if not catalog.get("media"):
        log("AniList catalog not found. Run tools/harvest_anilist_catalog.py first.")
        return 1
    if args.merge_only:
        payload = load_json(output_path, {"items": {}})
        merge_into_db(payload.get("items") or {})
        return 0

    db = load_json(DB_JSON, {})
    seed = load_seed_titles(catalog, db)
    complete = load_complete(db)
    selected = select_media(args, catalog, seed, complete)
    if not selected:
        log("No media selected.")
        return 1

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "pedia.watcha.com",
        "minPopularity": args.min_popularity,
        "formats": args.formats,
        "items": {},
    }
    if args.resume and output_path.exists():
        previous = load_json(output_path, {})
        if isinstance(previous.get("items"), dict):
            payload["items"] = previous["items"]

    items = payload["items"]
    total = len(selected)
    done = ok = skipped = 0
    started = time.time()
    sleep_seconds = max(0.3, args.sleep)
    log(
        f"harvest start: {total} media, minPopularity={args.min_popularity}, "
        f"formats={args.formats}, sleep={sleep_seconds}s"
    )
    for media in selected:
        media_id = media.get("id")
        key = str(media_id)
        previous = items.get(key)
        if previous and previous.get("status") == "ok":
            skipped += 1
            done += 1
            ok += 1
            continue
        if previous and previous.get("status") == "none" and not args.retry_none:
            skipped += 1
            done += 1
            continue
        result = harvest_media(media, seed.get(media_id, ""), sleep_seconds)
        result["harvestedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        items[key] = result
        done += 1
        if result.get("status") == "ok":
            ok += 1
            log(
                f"[{done}/{total}] ok id={media_id} {result['title']} "
                f"overview={bool(result['overview'])} conf={result['confidence']}"
            )
        else:
            log(f"[{done}/{total}] none id={media_id} reason={result.get('reason')}")
        if args.save_every and done % args.save_every == 0:
            payload["okCount"] = ok
            payload["processedCount"] = done
            save_output(output_path, payload)
            log(f"  saved: {done}/{total}, ok={ok}, elapsed={(time.time()-started)/60:.1f}m")

    payload["okCount"] = ok
    payload["processedCount"] = done
    payload["skippedCount"] = skipped
    payload["generatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    save_output(output_path, payload)
    log(
        f"harvest done: processed={done}, ok={ok}, skipped={skipped}, "
        f"elapsed={(time.time()-started)/60:.1f}m -> {output_path}"
    )
    if not args.no_merge:
        merge_into_db(items)
    return 0


if __name__ == "__main__":
    sys.exit(main())
