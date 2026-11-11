#!/usr/bin/env python3
"""한국어 위키백과 애니메이션 문서를 수확해 한국어 제목/소개 DB를 보강합니다.

수확 절차:
1. 한국어 위키백과의 애니메이션 관련 분류(연도별 TV 애니메이션, 애니메이션 영화,
   웹 애니메이션, OVA)를 재귀 수집합니다.
2. 각 문서의 위키데이터 QID를 얻고, P8729(AniList anime ID) /
   P4086(MyAnimeList anime ID) / 한국어·일본어·영어 레이블을 읽습니다.
3. ID가 없는 문서는 도입부에 적힌 **일본어 원제·영어 제목**을
   `data/anilist-catalog-harvest.json`의 원제/영어/로마자 제목과 대조해
   AniList 작품을 찾습니다. (정확 일치 → 접두 일치 순)
4. 문서 도입부(extract)를 한국어 소개로 정리합니다. 만화 원작 문서처럼
   애니메이션 문서가 아님이 분명한 경우에는 제목만 사용합니다.
5. 결과를 `data/korean-titles-db.json`의 `wikiEntries`에 병합합니다.
   기존 `entries`(플랫폼/카탈로그/TMDB/AniList/MAL)의 우선순위는 건드리지 않습니다.

정책:
- 한국어 위키백과에 실제로 적힌 제목과 소개만 사용합니다. 기계 번역은 하지 않습니다.
- 표시 우선순위는 나무위키 다음, 국내 통용 표기 이전입니다. 앱에서는
  `lookupKoreanWikiTitle()`로만 조회합니다.

사용:
    py tools/harvest_ko_wikipedia.py --max-pages 100     # 표본 검증
    py tools/harvest_ko_wikipedia.py --resume            # 전체 이어서
    py tools/harvest_ko_wikipedia.py --categories-only
"""

from __future__ import annotations

import argparse
import bisect
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KO_API = "https://ko.wikipedia.org/w/api.php"
WD_API = "https://www.wikidata.org/w/api.php"
RAW_OUTPUT = ROOT / "data" / "ko-wikipedia-harvest.json"
DB_JSON = ROOT / "data" / "korean-titles-db.json"
ANILIST_CATALOG = ROOT / "data" / "anilist-catalog-harvest.json"
USER_AGENT = "anime-hub-ko-wikipedia/1.0 (https://github.com/yejjun0909/anime-hub)"
HANGUL = re.compile(r"[\uac00-\ud7a3]")
HANGUL_ONLY = re.compile(r"^[\uac00-\ud7a3\s]+$")
KANA = re.compile(r"[\u3040-\u30ff]")
CJK = re.compile(r"[\u3400-\u9fff]")
YEAR_RE = re.compile(r"(19[3-9]\d|20[0-2]\d)\s*년")
SEASON_WORDS = re.compile(
    r"(?:시즌\s*\d+|\d+기|part\s*\d+|쿨|第\d+期|第\d+シーズン|season\s*\d+)$",
    re.I,
)
LANG_LABELS = (
    "일본어|영어|중국어|한국어|프랑스어|독일어|러시아어|스페인어|"
    "이탈리아어|포르투갈어|네덜란드어|폴란드어|라틴어"
)
LANG_LABEL_SPLIT = re.compile(r"\s*(?:" + LANG_LABELS + r")\s*:")
PAREN_SUFFIX = re.compile(
    r"\s*\((?:애니메이션|만화|만화 시리즈|영화|OVA|OAD|ONA|웹 애니메이션|TV 애니메이션|극장판|"
    r"텔레비전 애니메이션|비디오 게임|게임|비주얼 노벨|라이트 노벨|소설|책|드라마)\)\s*$"
)
GENERIC_TITLES = {
    "일본의 애니메이션",
    "일본의 애니메이션 영화",
    "일본의 애니메이션 영화 목록",
    "일본의 애니메이션 영화 흥행 기록",
    "일본의 웹 애니메이션",
    "일본의 텔레비전 애니메이션",
    "오리지널 비디오 애니메이션",
    "애니메이션",
    "텔레비전 애니메이션",
}
EXCLUDE_TITLE_RE = re.compile(
    r"(목록|등장인물|에피소드|성우|제작사|주제가|방송국|프로젝트|학교|회사|지주회사|브랜드)$"
)
EXCLUDE_CATEGORY_RE = re.compile(
    r"(등장인물|에피소드|목록|제작사|성우|주제가|방송국|회사|학교|프로젝트|만화|라이트 노벨|게임|미디어)"
)
ANIME_ITEM_IDS = {
    "Q1107",       # 일본 애니메이션
    "Q63952888",   # 일본 TV 애니메이션 시리즈
    "Q20650540",   # 일본 애니메이션 영화
    "Q202866",     # 애니메이션 영화
    "Q220898",     # 오리지널 비디오 애니메이션
    "Q581714",     # 애니메이션 시리즈
}
MANGA_ITEM_IDS = {"Q21198342", "Q8274", "Q11144425", "Q1210919"}
# 만화·게임·소설 등 원작 매체 (애니메이션 문서가 아님)
SOURCE_WORK_ITEM_IDS = {
    "Q7889",     # 비디오 게임
    "Q689445",   # 비주얼 노벨
    "Q747942",   # 라이트 노벨
    "Q8261",     # 소설
    "Q571",      # 책
    "Q7725634",  # 문학 작품
    "Q1004",     # 만화
    "Q1280242",  # 일본 만화
    "Q21198342", # 만화 시리즈
    "Q8274",     # 만화
}
MANGA_WORD = re.compile(r"만화|漫画|マンガ")
ANIME_WORD = re.compile(r"애니메이션|アニメ|OVA|ONA|극장판")
SOURCE_WORK_WORD = re.compile(
    r"만화|漫画|マンガ|비디오 게임|게임|에로게|비주얼 노벨|라이트 노벨|노벨|소설|책|드라마|문학 작품"
)
# 미디어 믹스/프랜차이즈 문서는 애니메이션 문서가 아닐 수 있습니다.
FRANCHISE_WORD = re.compile(r"프랜차이즈|미디어 믹스|멀티미디어|프로젝트|기획")
# 작품의 형식이 분명한 경우(프랜차이즈 문서라도 애니메이션 자체를 설명하면 소개 허용)
ANIME_FORM_WORD = re.compile(
    r"텔레비전 애니메이션|TV 애니메이션|애니메이션 영화|OVA|OAD|ONA|"
    r"웹 애니메이션|넷 애니메이션|애니메이션 시리즈|단편 애니메이션"
)
# 방송 채널·기업 문서는 애니메이션 작품이 아니므로 제목조차 쓰지 않습니다.
NON_ANIME_ARTICLE = re.compile(r"텔레비전 채널|방송 채널|케이블 채널|위성 채널|라디오 방송국")

CATEGORY_ROOTS = (
    "분류:일본의 애니메이션",
    "분류:일본의 텔레비전 애니메이션",
    "분류:일본의 애니메이션 영화",
    "분류:일본의 웹 애니메이션",
    "분류:오리지널 비디오 애니메이션",
)


def log(message: str) -> None:
    print(message, flush=True)


def request_json(base: str, params: dict, retries: int = 6, use_maxlag: bool = True) -> dict:
    base_params = {**params, "format": "json", "formatversion": "2", "utf8": "1"}
    if use_maxlag:
        base_params["maxlag"] = "5"
    payload = urllib.parse.urlencode(base_params).encode("utf-8")
    delay = 2.0
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(
            base,
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.loads(response.read().decode("utf-8"))
            error = data.get("error") if isinstance(data, dict) else None
            if error:
                code = str(error.get("code") or "")
                if code in {"maxlag", "ratelimited", "readonly", "internal_api_error_DBConnectionError"}:
                    wait = delay
                    log(f"  API {code}; {wait:.1f}초 후 재시도 ({attempt + 1}/{retries})")
                    time.sleep(wait)
                    delay = min(delay * 1.7, 45.0)
                    continue
                raise RuntimeError(f"API 오류 {code}: {str(error.get('info') or '')[:200]}")
            return data
        except urllib.error.HTTPError as error:
            last_error = error
            retry_after = error.headers.get("Retry-After") if error.headers else None
            wait = float(retry_after) if retry_after and retry_after.isdigit() else delay
            log(f"  HTTP {error.code}; {wait:.1f}초 후 재시도 ({attempt + 1}/{retries})")
            time.sleep(wait)
            delay = min(delay * 1.7, 45.0)
        except Exception as error:  # noqa: BLE001
            last_error = error
            log(f"  요청 오류: {error}; {delay:.1f}초 후 재시도 ({attempt + 1}/{retries})")
            time.sleep(delay)
            delay = min(delay * 1.7, 45.0)
    raise RuntimeError(f"API 요청 실패: {last_error}")


def wikipedia(params: dict) -> dict:
    return request_json(KO_API, {"action": "query", **params}, use_maxlag=True)


def wikidata(params: dict) -> dict:
    return request_json(WD_API, {"action": "wbgetentities", **params}, use_maxlag=False)


def has_hangul(text: str) -> bool:
    return bool(HANGUL.search(text or ""))


def normalize_key(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = re.sub(r"\([^)]*\)|\[[^\]]*\]|《[^》]*》|〈[^〉]*〉|『[^』]*』", " ", text)
    text = re.sub(r"[\s\W_]+", "", text, flags=re.UNICODE)
    return text


def title_keys(value: str) -> list[str]:
    key = normalize_key(value)
    if len(key) < 2:
        return []
    keys = [key]
    base = SEASON_WORDS.sub("", key)
    if base and base != key and len(base) >= 2:
        keys.append(base)
    return list(dict.fromkeys(keys))


def script_kind(value: str) -> str:
    text = str(value or "")
    if has_hangul(text):
        return "ko"
    if KANA.search(text) or CJK.search(text):
        return "ja"
    if re.search(r"[A-Za-z]", text):
        return "en"
    return "other"


def strip_reading(raw: str) -> str:
    """`원제 한국어독음` 형태에서 뒤쪽 한국어 독음을 잘라냅니다."""
    text = " ".join(str(raw or "").split())
    if not text:
        return ""
    # 괄호가 열린 채 잘린 조각(예: `21 (にじゅういち`)은 원제로 쓰지 않습니다.
    if text.count("(") != text.count(")"):
        text = text.split("(", 1)[0].strip()
    if not text:
        return ""
    tokens = text.split(" ")
    if len(tokens) <= 1:
        return text
    cut = len(tokens)
    for index in range(1, len(tokens)):
        if HANGUL_ONLY.match(tokens[index]) and all(
            HANGUL_ONLY.match(token) for token in tokens[index:]
        ):
            cut = index
            break
    return " ".join(tokens[:cut]).strip(" ,.;·")


def extract_titles(text: str) -> tuple[list[str], list[str]]:
    """도입부에서 일본어 원제와 영어 제목 후보를 뽑습니다."""
    head = str(text or "")[:500]
    ja: list[str] = []
    en: list[str] = []

    for label in ("ja", "en"):
        pattern = re.compile(r"일본어\s*:\s*([^)\n]+)") if label == "ja" else re.compile(r"영어\s*:\s*([^)\n]+)")
        for match in pattern.finditer(head):
            raw = LANG_LABEL_SPLIT.split(match.group(1))[0]
            raw = re.split(r"\s*[,;]\s*", raw)[0]
            raw = re.sub(r"\[\*?\]", "", raw)
            raw = raw.strip(" ,.;:·")
            if label == "ja":
                value = strip_reading(raw)
                if value and script_kind(value) == "ja":
                    ja.append(value)
            else:
                if raw and script_kind(raw) == "en":
                    en.append(raw)

    match = re.match(r"^\s*[《〈『\"']?[^()（）]{1,90}[》〉』\"']?\s*[（(]([^)）]{2,140})[)）]", head)
    if match:
        content = re.sub(r"\[\*?\]", "", match.group(1))
        for part in LANG_LABEL_SPLIT.split(content):
            part = re.split(r"\s*[,;]\s*", part)[0].strip()
            if not part:
                continue
            part = strip_reading(part)
            kind = script_kind(part)
            if kind == "ja":
                ja.append(part)
            elif kind == "en":
                en.append(part)

    return list(dict.fromkeys(value for value in ja if value)), list(
        dict.fromkeys(value for value in en if value)
    )


def intro_year(text: str) -> int | None:
    match = YEAR_RE.search(str(text or "")[:600])
    return int(match.group(1)) if match else None


def kind_for_category(category: str) -> str:
    if "영화" in category:
        return "MOVIE"
    if "웹" in category:
        return "WEB"
    if "오리지널 비디오" in category or "OVA" in category:
        return "OVA"
    return "TV"


def should_expand(category: str, depth: int, max_depth: int) -> bool:
    if depth >= max_depth:
        return False
    name = str(category or "").removeprefix("분류:")
    if EXCLUDE_CATEGORY_RE.search(name):
        return False
    return bool(re.search(r"(연도별|시작 연도별|\d{4}년)", name))


def category_members(category: str) -> tuple[list[str], list[str]]:
    pages: list[str] = []
    subcats: list[str] = []
    params: dict = {
        "list": "categorymembers",
        "cmtitle": category,
        "cmlimit": "500",
        "cmtype": "page|subcat",
    }
    while True:
        data = wikipedia(params)
        for row in (data.get("query") or {}).get("categorymembers") or []:
            title = str(row.get("title") or "").strip()
            if not title:
                continue
            if int(row.get("ns") or 0) == 14:
                subcats.append(title)
            elif int(row.get("ns") or 0) == 0:
                pages.append(title)
        cont = data.get("continue") or {}
        if not cont.get("cmcontinue"):
            break
        params = {**params, "cmcontinue": cont["cmcontinue"]}
        time.sleep(0.8)
    return pages, subcats


def collect_categories(max_depth: int = 2) -> dict[str, str]:
    page_kind: dict[str, str] = {}
    visited: set[str] = set()

    def visit(category: str, depth: int) -> None:
        if category in visited:
            return
        visited.add(category)
        try:
            pages, subcats = category_members(category)
        except Exception as error:  # noqa: BLE001
            log(f"  분류 실패 {category}: {error}")
            return
        kind = kind_for_category(category)
        for page in pages:
            page_kind.setdefault(page, kind)
        log(f"  분류 {category}: 문서 {len(pages)} · 하위 {len(subcats)}")
        time.sleep(0.8)
        for subcat in subcats:
            if should_expand(subcat, depth, max_depth):
                visit(subcat, depth + 1)

    for root in CATEGORY_ROOTS:
        visit(root, 0)
    return page_kind


def is_candidate_page(title: str) -> bool:
    name = str(title or "").strip()
    if not name or name in GENERIC_TITLES:
        return False
    if name.startswith(("분류:", "틀:", "파일:", "위키백과:", "모듈:", "도움말:")):
        return False
    if EXCLUDE_TITLE_RE.search(name):
        return False
    if len(name) > 90:
        return False
    return True


def fetch_pageprops(titles: list[str]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for start in range(0, len(titles), 45):
        chunk = titles[start : start + 45]
        data = wikipedia(
            {
                "prop": "pageprops",
                "ppprop": "wikibase_item|disambiguation",
                "titles": "|".join(chunk),
                "redirects": "1",
            }
        )
        for page in (data.get("query") or {}).get("pages") or []:
            title = str(page.get("title") or "").strip()
            if not title or page.get("missing"):
                continue
            props = page.get("pageprops") or {}
            result[title] = {
                "pageid": page.get("pageid"),
                "title": title,
                "qid": props.get("wikibase_item"),
                "disambiguation": "disambiguation" in props,
            }
        time.sleep(0.8)
    return result


def first_time_year(values: list[str]) -> int | None:
    for value in values:
        match = YEAR_RE.search(str(value or ""))
        if match:
            return int(match.group(1))
    return None


def parse_entity(entity: dict) -> dict:
    labels = {
        lang: str(row.get("value") or "").strip()
        for lang, row in (entity.get("labels") or {}).items()
    }
    aliases: dict[str, list[str]] = {}
    for lang, rows in (entity.get("aliases") or {}).items():
        aliases[lang] = [str(row.get("value") or "").strip() for row in rows if row.get("value")]
    claims = entity.get("claims") or {}

    def claim_values(prop: str, field: str = "id") -> list:
        values = []
        for statement in claims.get(prop) or []:
            if statement.get("rank") == "deprecated":
                continue
            value = ((statement.get("mainsnak") or {}).get("datavalue") or {}).get("value")
            if isinstance(value, dict) and field in value:
                values.append(value[field])
            elif value is not None and field == "value":
                values.append(value)
        return values

    def numeric_ids(prop: str) -> list[int]:
        ids = []
        for value in claim_values(prop, "value"):
            try:
                ids.append(int(str(value).strip()))
            except (TypeError, ValueError):
                continue
        return ids

    return {
        "labels": labels,
        "aliases": aliases,
        "p31": claim_values("P31", "id"),
        "anilist_ids": numeric_ids("P8729"),
        "mal_ids": numeric_ids("P4086"),
        "mal_manga_ids": numeric_ids("P4087"),
        "anilist_manga_ids": numeric_ids("P8731"),
        "year": first_time_year(claim_values("P577", "time") + claim_values("P580", "time")),
        "kowiki": str(((entity.get("sitelinks") or {}).get("kowiki") or {}).get("title") or "").strip(),
    }


def fetch_entities(qids: list[str]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for start in range(0, len(qids), 45):
        chunk = qids[start : start + 45]
        data = wikidata(
            {
                "ids": "|".join(chunk),
                "props": "labels|aliases|claims|sitelinks",
                "languages": "ko|ja|en",
                "sitefilter": "kowiki",
            }
        )
        for qid, entity in (data.get("entities") or {}).items():
            if not isinstance(entity, dict) or entity.get("missing"):
                continue
            result[qid] = parse_entity(entity)
        time.sleep(0.8)
    return result


def fetch_extracts(titles: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for start in range(0, len(titles), 20):
        chunk = titles[start : start + 20]
        data = wikipedia(
            {
                "prop": "extracts",
                "exintro": "1",
                "explaintext": "1",
                "exlimit": "max",
                "titles": "|".join(chunk),
                "redirects": "1",
            }
        )
        for page in (data.get("query") or {}).get("pages") or []:
            title = str(page.get("title") or "").strip()
            if not title or page.get("missing"):
                continue
            extract = str(page.get("extract") or "")
            if extract:
                result[title] = extract
        time.sleep(0.8)
    return result


def clean_korean_title(title: str) -> str | None:
    text = PAREN_SUFFIX.sub("", str(title or "")).strip()
    text = " ".join(text.split()).strip(" \t\"'`“”‘’《》<>[]")
    if not text or text in GENERIC_TITLES:
        return None
    if not has_hangul(text):
        return None
    if len(text) < 2 or len(text) > 60:
        return None
    if EXCLUDE_TITLE_RE.search(text):
        return None
    return text


def choose_korean_title(page_title: str, labels: dict, aliases: dict) -> str | None:
    for candidate in [page_title, labels.get("ko"), *aliases.get("ko", [])]:
        title = clean_korean_title(candidate)
        if title:
            return title
    return None


def clean_overview(text: str, limit: int = 600) -> str:
    value = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"\(일본어:[^)]*\)|\(영어:[^)]*\)|\(중국어:[^)]*\)", " ", value)
    value = re.sub(r"\[[^\]]*\]", " ", value)
    value = re.sub(r"\{\{[^}]*\}\}", " ", value)
    value = re.sub(r"<[^>]*>", " ", value)
    value = value.replace("'''", "").replace("''", "")
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) < 25 or not has_hangul(value):
        return ""
    compact = re.sub(r"\s", "", value)
    hangul_ratio = len(HANGUL.findall(compact)) / max(len(compact), 1)
    if hangul_ratio < 0.25:
        return ""
    if re.search(r"동음이의|가리킨다|목록 문서|다음을 가리키는", value[:160]):
        return ""
    if len(value) <= limit:
        return value
    cut = value[:limit]
    last = max(cut.rfind(". "), cut.rfind("다. "), cut.rfind("。"))
    return (cut[: last + 1] if last > 120 else cut).strip() + "…"


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def build_anilist_index() -> dict:
    catalog = load_json(ANILIST_CATALOG, {"media": {}})
    by_id: dict[int, dict] = {}
    by_mal: dict[int, dict] = {}
    exact: dict[str, list[tuple[dict, str]]] = {}
    for media in (catalog.get("media") or {}).values():
        try:
            media_id = int(media.get("id"))
        except (TypeError, ValueError):
            continue
        by_id[media_id] = media
        mal = media.get("idMal")
        if isinstance(mal, int):
            by_mal[mal] = media
        title = media.get("title") or {}
        for field, match_type in (
            ("native", "ja"),
            ("english", "en"),
            ("romaji", "romaji"),
        ):
            for key in title_keys(title.get(field)):
                exact.setdefault(key, []).append((media, match_type))
        for synonym in media.get("synonyms") or []:
            for key in title_keys(synonym):
                exact.setdefault(key, []).append((media, "synonym"))
    return {
        "by_id": by_id,
        "by_mal": by_mal,
        "exact": exact,
        "sorted_keys": sorted(exact.keys()),
        "catalog_count": len(by_id),
    }


def format_matches(kind: str, anilist_format: str | None) -> bool:
    fmt = str(anilist_format or "").upper()
    mapping = {
        "TV": {"TV", "TV_SHORT"},
        "MOVIE": {"MOVIE"},
        "OVA": {"OVA"},
        "WEB": {"ONA", "TV_SHORT"},
    }
    allowed = mapping.get(kind)
    return True if not allowed else fmt in allowed


BASE_SCORE = {
    "ja": 42.0,
    "ko": 34.0,
    "en": 26.0,
    "romaji": 23.0,
    "synonym": 21.0,
}
READING_CHARS = set("・ー ")


def is_reading_remainder(value: str) -> bool:
    return bool(value) and all(
        HANGUL.match(char) or KANA.match(char) or char in READING_CHARS for char in value
    )


def score_media(media: dict, match_type: str, year: int | None, kind: str) -> float:
    score = BASE_SCORE.get(match_type, 18.0)
    if format_matches(kind, media.get("format")):
        score += 4.0
    else:
        score -= 2.0
    media_year = media.get("year")
    if isinstance(year, int) and isinstance(media_year, int):
        diff = abs(year - media_year)
        if diff == 0:
            score += 10.0
        elif diff == 1:
            score += 4.0
        elif diff == 2:
            score -= 3.0
        elif diff <= 4:
            score -= 6.0
        else:
            score -= 10.0
    score += min(int(media.get("popularity") or 0), 2_000_000) / 2_000_000
    return score


def find_keyed_matches(key: str, index: dict) -> list[tuple[dict, str, str]]:
    """정확 일치, 뒤에 독음만 붙은 접두 일치, 원제 앞부분 일치를 찾습니다."""
    results: list[tuple[dict, str, str]] = []
    for media, match_type in index["exact"].get(key, []):
        results.append((media, match_type, "exact"))
    for end in range(3, len(key)):
        remainder = key[end:]
        if not is_reading_remainder(remainder):
            continue
        for media, match_type in index["exact"].get(key[:end], []):
            results.append((media, match_type, "reading"))
    # 원제 앞부분만 적힌 경우(예: `鋼の錬金術師` → `鋼の錬金術師 FULLMETAL ALCHEMIST`)
    if len(key) >= 4 and (CJK.search(key) or KANA.search(key)):
        sorted_keys = index["sorted_keys"]
        position = bisect.bisect_left(sorted_keys, key)
        taken = 0
        while position < len(sorted_keys) and sorted_keys[position].startswith(key):
            longer = sorted_keys[position]
            position += 1
            if len(longer) > len(key) + 26:
                continue
            for media, match_type in index["exact"].get(longer, []):
                results.append((media, match_type, "prefix"))
            taken += 1
            if taken >= 24:
                break
    return results


def match_anilist(item: dict, index: dict) -> tuple[dict | None, str]:
    anilist_id = item.get("anilist_id")
    if anilist_id and int(anilist_id) in index["by_id"]:
        return index["by_id"][int(anilist_id)], "wikidata-p8729"
    mal_id = item.get("mal_id")
    if mal_id and int(mal_id) in index["by_mal"]:
        return index["by_mal"][int(mal_id)], "wikidata-p4086"

    year = item.get("year")
    kind = item.get("kind") or "TV"
    # 만화·게임 원작 문서는 동의어(synonym) 일치를 신뢰하지 않습니다.
    # 원작 쪽 한국어 제목이 애니메이션 별칭과 우연히 겹치는 오매칭을 막습니다.
    allow_synonyms = not item.get("source_work")

    candidate_keys: list[tuple[str, str]] = []  # (key, source)
    for source, values in (
        ("ja_intro", item.get("ja_titles") or []),
        ("en_intro", item.get("en_titles") or []),
        ("ja_label", [item.get("labels", {}).get("ja")]),
        ("en_label", [item.get("labels", {}).get("en")]),
        ("ko_label", [item.get("labels", {}).get("ko")]),
        ("page", [item.get("page_title")]),
        ("ja_alias", item.get("aliases", {}).get("ja") or []),
        ("en_alias", item.get("aliases", {}).get("en") or []),
    ):
        # 원작 문서는 영어 제목이 애니메이션 제목과 다를 수 있어(예: 만화 TAKE MOON
        # → 애니메이션 Carnival Phantasm) 영어 기반 후보를 쓰지 않습니다.
        if item.get("source_work") and source.startswith("en"):
            continue
        for value in values:
            for key in title_keys(value or ""):
                candidate_keys.append((key, source))

    if not candidate_keys:
        return None, "none"

    scores: dict[int, tuple[float, str, dict]] = {}
    for key, source in candidate_keys:
        for media, match_type, match_flag in find_keyed_matches(key, index):
            media_id = media.get("id")
            if not isinstance(media_id, int):
                continue
            if not allow_synonyms and match_type == "synonym":
                continue
            score = score_media(media, match_type, year, kind)
            if match_flag == "reading":
                score -= 6.0
            elif match_flag == "prefix":
                score -= 10.0
            if source.startswith("en") and match_type in {"ja", "synonym"}:
                score -= 4.0
            if source == "ja_intro" and match_type == "ja":
                score += 3.0
            previous = scores.get(media_id)
            label = f"{match_type}:{source}" + ("" if match_flag == "exact" else f":{match_flag}")
            if previous is None or score > previous[0]:
                scores[media_id] = (score, label, media)

    if not scores:
        return None, "none"
    ranked = sorted(scores.values(), key=lambda row: -row[0])
    best = ranked[0]
    if best[0] < 20.0:
        return None, "none"
    if len(ranked) > 1 and best[0] - ranked[1][0] < 2.0:
        return None, "ambiguous"
    return best[2], best[1]


def is_manga_only(meta: dict) -> bool:
    if meta.get("anilist_ids") or meta.get("mal_ids"):
        return False
    p31 = set(meta.get("p31") or [])
    if p31 & ANIME_ITEM_IDS:
        return False
    return bool(p31 & MANGA_ITEM_IDS or meta.get("mal_manga_ids") or meta.get("anilist_manga_ids"))


def is_source_work(meta: dict, page_title: str, extract: str) -> bool:
    """만화·게임·소설 등 원작 문서인지 판단합니다(애니메이션 문서가 아님).

    위키데이터에 AniList/MAL ID(P8729/P4086)가 있어도 그 문서가 애니메이션
    자체를 설명한다는 뜻은 아니므로, ID 유무로 판단을 건너뛰지 않습니다.
    """
    p31 = set(meta.get("p31") or [])
    if p31 & ANIME_ITEM_IDS:
        return False
    if p31 & SOURCE_WORK_ITEM_IDS:
        return True
    if re.search(
        r"\((비디오 게임|게임|비주얼 노벨|라이트 노벨|소설|책|드라마|만화)\)", page_title
    ):
        return True
    return looks_like_source_work_article(extract)


def first_sentence(text: str, limit: int = 240) -> str:
    head = " ".join(str(text or "")[:limit].split())
    if not head:
        return ""
    return re.split(r"(?:다\.|。|\n)", head, maxsplit=1)[0]


def is_non_anime_article(extract: str) -> bool:
    """방송 채널 등 애니메이션 작품이 아닌 문서인지 판단합니다."""
    first = first_sentence(extract, 160)
    if not first or ANIME_FORM_WORD.search(first):
        return False
    return bool(NON_ANIME_ARTICLE.search(first))


def looks_like_source_work_article(extract: str) -> bool:
    """도입부 첫 문장이 원작 매체(만화·게임·소설 등) 설명이면 True."""
    first = first_sentence(extract)
    if not first:
        return False
    if FRANCHISE_WORD.search(first) and not ANIME_FORM_WORD.search(first):
        # 미디어 믹스/프랜차이즈 문서는 작품 자체 문서가 아닐 수 있습니다.
        return True
    if ANIME_WORD.search(first):
        # `만화를 원작으로 한 애니메이션`처럼 애니메이션이 주어이면 원작 문서가 아닙니다.
        return False
    return bool(SOURCE_WORK_WORD.search(first))


def overview_disallowed_by_text(overview: str) -> bool:
    """저장된 소개 문장만으로 애니메이션 소개가 아니라고 판단합니다."""
    return looks_like_source_work_article(overview) or is_non_anime_article(overview)


def looks_like_manga_article(extract: str) -> bool:
    """도입부가 만화 작품 설명 위주인지 판단합니다(애니메이션 언급보다 많으면)."""
    head = str(extract or "")[:400]
    if not head:
        return False
    manga = len(MANGA_WORD.findall(head))
    anime = len(ANIME_WORD.findall(head))
    return manga > anime


def overview_allowed(
    meta: dict,
    page_title: str,
    kind: str,
    matched_by: str,
    extract: str = "",
    source_work: bool = False,
) -> bool:
    if matched_by == "none":
        return False
    if source_work:
        return False
    if is_non_anime_article(extract):
        return False
    p31 = set(meta.get("p31") or [])
    if p31 & ANIME_ITEM_IDS:
        return True
    if re.search(r"\((애니메이션|극장판|OVA|OAD|ONA|웹 애니메이션)\)", page_title):
        return True
    # P31이 비어 있어도 도입부 첫 문장이 만화·게임·소설 등 원작 설명이면
    # 애니메이션 소개로 쓰지 않습니다. (예: 비주얼 노벨 문서의 소개)
    if looks_like_source_work_article(extract):
        return False
    if is_manga_only(meta) or looks_like_manga_article(extract):
        return False
    return True


def merge_wiki_entries(items: dict[str, dict]) -> dict:
    db = load_json(DB_JSON, {"version": 2, "entries": {}, "wikiEntries": {}})
    wiki_entries = db.get("wikiEntries")
    if not isinstance(wiki_entries, dict):
        wiki_entries = {}
        db["wikiEntries"] = wiki_entries

    added = 0
    updated = 0
    kept = 0
    for item in items.values():
        if item.get("non_anime"):
            continue
        anilist_id = item.get("anilist_id")
        mal_id = item.get("mal_id")
        title = str(item.get("title") or "").strip()
        if not title or not (anilist_id or mal_id):
            continue
        overview = str(item.get("overview") or "").strip()
        if overview and is_non_anime_article(overview):
            # 방송 채널 등 애니메이션 작품이 아닌 문서는 제목도 쓰지 않습니다.
            item["overview"] = ""
            item["source_work"] = True
            continue
        if overview and overview_disallowed_by_text(overview):
            # 만화·게임 원작 또는 프랜차이즈 문서의 소개는 애니메이션 소개가 아니므로
            # 제목만 남기고 소개는 비웁니다.
            overview = ""
            item["overview"] = ""
            item["source_work"] = True
        key = str(anilist_id) if anilist_id else f"mal:{mal_id}"
        entry = {
            "anilistId": anilist_id,
            "malId": mal_id,
            "title": title,
            "overview": overview,
            "source": "wiki",
            "confidence": float(item.get("confidence") or 0.8),
            "url": str(item.get("url") or "").strip(),
            "qid": str(item.get("qid") or "").strip(),
            "matchedBy": str(item.get("matched_by") or "").strip(),
            "pageTitle": str(item.get("page_title") or "").strip(),
            "kind": str(item.get("kind") or "TV").strip(),
        }
        existing = wiki_entries.get(key)
        if existing is None:
            wiki_entries[key] = entry
            added += 1
            continue
        existing_has_overview = bool(str(existing.get("overview") or "").strip())
        new_has_overview = bool(entry["overview"])
        if new_has_overview and not existing_has_overview:
            wiki_entries[key] = entry
            updated += 1
        elif not new_has_overview and existing_has_overview:
            kept += 1
        elif entry["confidence"] > float(existing.get("confidence") or 0):
            wiki_entries[key] = entry
            updated += 1
        else:
            kept += 1

    db["wikiEntries"] = wiki_entries
    db["wikiCount"] = len(wiki_entries)
    db["wikiGeneratedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    DB_JSON.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    log(f"wikiEntries 병합: 신규 {added}건, 갱신 {updated}건, 유지 {kept}건 (총 {len(wiki_entries)}건)")
    return db


def main() -> int:
    parser = argparse.ArgumentParser(description="한국어 위키백과 애니메이션 제목/소개 수확")
    parser.add_argument("--max-pages", type=int, default=6000, help="처리할 최대 문서 수")
    parser.add_argument("--max-depth", type=int, default=2, help="하위 분류 확장 깊이")
    parser.add_argument("--resume", action="store_true", help="기존 수확 파일에 이어서 처리")
    parser.add_argument("--refresh-overviews", action="store_true", help="저장된 문서의 소개를 다시 조회")
    parser.add_argument("--categories-only", action="store_true", help="분류/문서 목록만 출력")
    parser.add_argument("--no-merge", action="store_true", help="DB에 병합하지 않고 원본만 저장")
    args = parser.parse_args()

    log("분류 수집 중...")
    page_kind = collect_categories(max_depth=max(1, args.max_depth))
    candidates = [title for title in page_kind if is_candidate_page(title)]
    candidates.sort()
    log(f"후보 문서: {len(candidates)}개")

    if args.categories_only:
        for title in candidates[:200]:
            print(f"{page_kind.get(title, 'TV')}\t{title}")
        return 0

    raw = load_json(
        RAW_OUTPUT,
        {"version": 2, "generatedAt": "", "items": {}, "processedPages": [], "failedPages": []},
    )
    items: dict[str, dict] = raw.get("items") or {}
    processed = set(str(title) for title in (raw.get("processedPages") or []))
    failed = set(str(title) for title in (raw.get("failedPages") or []))
    if args.refresh_overviews:
        processed = {title for title in processed if not (items.get(title) or {}).get("overview")}
    if args.resume:
        log(f"이어서 처리: 완료 {len(processed)}개, 실패 {len(failed)}개")
    else:
        processed = set()
        failed = set()

    index = build_anilist_index()
    log(f"AniList 매칭 인덱스: {index['catalog_count']}작품")
    if not index["catalog_count"]:
        log("경고: AniList 카탈로그가 없습니다. `py tools/harvest_anilist_catalog.py`를 먼저 실행하세요.")

    pending = [title for title in candidates if title not in processed]
    if args.max_pages:
        pending = pending[: args.max_pages]
    log(f"이번에 처리할 문서: {len(pending)}개")

    for start in range(0, len(pending), 45):
        chunk = pending[start : start + 45]
        try:
            props = fetch_pageprops(chunk)
        except Exception as error:  # noqa: BLE001
            log(f"  pageprops 실패({start}-{start + len(chunk) - 1}): {error}")
            failed.update(chunk)
            continue

        # 넘겨준 제목이 결과에 없으면 넘겨주기(redirect)로 다른 문서에 합쳐졌거나
        # 문서가 없는 경우입니다. 다시 조회하지 않도록 처리 완료로 표시합니다.
        skipped = [title for title in chunk if title not in props]
        processed.update(skipped)

        qids = sorted({row["qid"] for row in props.values() if row.get("qid")})
        try:
            entities = fetch_entities(qids) if qids else {}
        except Exception as error:  # noqa: BLE001
            log(f"  Wikidata 실패({start}-{start + len(chunk) - 1}): {error}")
            failed.update(chunk)
            continue

        titles = [row["title"] for row in props.values() if not row.get("disambiguation")]
        try:
            extracts = fetch_extracts(titles) if titles else {}
        except Exception as error:  # noqa: BLE001
            log(f"  extracts 실패({start}-{start + len(chunk) - 1}): {error}")
            extracts = {}

        for title, row in props.items():
            if row.get("disambiguation"):
                processed.add(title)
                continue
            qid = row.get("qid")
            meta = entities.get(qid, {}) if qid else {}
            kind = page_kind.get(title, "TV")
            labels = meta.get("labels") or {}
            aliases = meta.get("aliases") or {}
            korean_title = choose_korean_title(title, labels, aliases)
            if not korean_title:
                processed.add(title)
                continue
            extract = extracts.get(title, "")
            if is_non_anime_article(extract):
                processed.add(title)
                continue
            ja_titles, en_titles = extract_titles(extract)
            source_work = is_source_work(meta, title, extract)
            item = {
                "page_title": title,
                "qid": qid,
                "labels": labels,
                "aliases": aliases,
                "ja_titles": ja_titles,
                "en_titles": en_titles,
                "anilist_id": (meta.get("anilist_ids") or [None])[0],
                "mal_id": (meta.get("mal_ids") or [None])[0],
                "year": meta.get("year") or intro_year(extract),
                "kind": kind,
                "manga_only": is_manga_only(meta),
                "source_work": source_work,
                "title": korean_title,
            }
            media, matched_by = match_anilist(item, index)
            if not media and item["anilist_id"] is None and item["mal_id"] is None:
                processed.add(title)
                continue
            if media:
                item["anilist_id"] = media.get("id") if media.get("id") is not None else item["anilist_id"]
                item["mal_id"] = media.get("idMal") if media.get("idMal") is not None else item["mal_id"]
            overview = ""
            if overview_allowed(meta, title, kind, matched_by, extract, source_work):
                overview = clean_overview(extract)
            confidence = 0.95 if matched_by.startswith("wikidata") else 0.8
            item.update(
                {
                    "overview": overview,
                    "matched_by": matched_by,
                    "confidence": confidence,
                    "url": "https://ko.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
                    "anilist_title": ((media or {}).get("title") or {}).get("romaji", ""),
                }
            )
            items[title] = item
            processed.add(title)

        raw["items"] = items
        raw["processedPages"] = sorted(processed)
        raw["failedPages"] = sorted(failed)
        raw["generatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        RAW_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        RAW_OUTPUT.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
        matched = sum(1 for item in items.values() if item.get("anilist_id") or item.get("mal_id"))
        log(
            f"  {min(start + 45, len(pending))}/{len(pending)} 처리 · 연결 {matched}건 · "
            f"소개 {sum(1 for item in items.values() if item.get('overview'))}건"
        )

    matched = sum(1 for item in items.values() if item.get("anilist_id") or item.get("mal_id"))
    with_overview = sum(1 for item in items.values() if item.get("overview"))
    log(f"원본 저장: {RAW_OUTPUT} (문서 {len(items)}개, 연결 {matched}개, 소개 {with_overview}개)")
    if not args.no_merge:
        merge_wiki_entries(items)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
