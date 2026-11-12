#!/usr/bin/env python3
"""나무위키 애니메이션 문서에서 한국어 제목/소개를 수확합니다.

나무위키는 검색 결과와 문서 HTML을 서버에서 렌더링해 제공합니다. 이 도구는
`/search/<query>` 로 후보 문서를 찾고, `/w/<title>` 본문에서 원제·애니메이션
형식·연도를 확인한 뒤에만 제목을 채택합니다. 소개는 문서가 특정 애니메이션
작품 문서로 확인될 때만 사용합니다.

수확 결과는 `data/namu-harvest.json` 에 따로 저장하고, `--merge` 로
`data/korean-titles-db.json` 의 `namuEntries` 에 병합합니다. 기존 `entries`
(플랫폼/TMDB/AniList/MAL/검증 DB)와 `wikiEntries` 는 덮어쓰지 않습니다.

사용:
    py tools/harvest_namu.py --min-popularity 5000 --limit 50
    py tools/harvest_namu.py --min-popularity 5000 --resume
    py tools/harvest_namu.py --merge-only
    py tools/harvest_namu.py --ids 101922,113415
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
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANILIST_CATALOG = ROOT / "data" / "anilist-catalog-harvest.json"
DB_JSON = ROOT / "data" / "korean-titles-db.json"
DEFAULT_OUTPUT = ROOT / "data" / "namu-harvest.json"

BASE = "https://namu.wiki"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,ja;q=0.8,en;q=0.7",
}
SEARCH_RE = re.compile(
    r"<h4[^>]*>.*?<a href=\"/w/([^\"]+)\"[^>]*>(.*?)</a></h4>\s*<div[^>]*>(.*?)</div>",
    re.S,
)
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
OG_RE = re.compile(r'<meta property="og:description" content="(.*?)"', re.S)
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
BRACKET_REF_RE = re.compile(r"\s*\[\d+(?:\.\d+)?\]")
NAV_RE = re.compile(
    r"(?:자세한|상세한|더 자세한)\s*내용은\s*.{0,80}?\s*문서(?:와\s*.{0,40}?\s*문서)?를?\s*참고하십시오\.?"
)
HANGUL_RE = re.compile(r"[가-힣]")
KANA_RE = re.compile(r"[ぁ-んァ-ヶー]")
CJK_RE = re.compile(r"[一-龯]")
ANIME_TEXT = re.compile(r"애니메이션|TVA|OVA|OAD|ONA|극장판|방영|개봉|쿨")
ANIME_STRONG = re.compile(
    r"방영|개봉|TVA|OVA|OAD|ONA|극장판|TV\s*애니메이션|"
    r"애니메이션\s*(?:영화|시리즈|작품|제작|스튜디오|스튜디오)"
)
SOURCE_WORK_TEXT = re.compile(r"만화|웹툰|소설|라이트\s*노벨|게임|드라마|뮤지컬|실사화")
BLOCKED_PATH_PREFIXES = ("틀:", "파일:", "분류:", "사용자:", "나무위키:", "특수기능:")
SEASON_NUMBER_RE = re.compile(r"(?:Season\s*|第\s*)(\d+)\s*(?:기|期|Season)?|(\d+)\s*기", re.I)
GENERIC_TITLES = {
    "애니메이션",
    "일본 애니메이션",
    "일본의 애니메이션",
    "TVA",
    "OVA",
    "OAD",
    "ONA",
    "극장판",
    "영화",
}
BLOCK_TITLE_RE = re.compile(
    r"목록|등장인물|캐릭터|OST|음반|수록곡|주제가|가사|음악|성우|제작사|방송국|"
    r"미디어\s*믹스|원작|리듬\s*게임|콜라보|극장판\s*시리즈|시리즈\s*목록|"
    r"\(만화\)|\(웹툰\)|\(소설\)|\(게임\)|\(드라마\)|\(라이트\s*노벨\)|"
    r"\((?:배우|성우|가수|감독|작가|만화가|애니메이터|일러스트레이터|프로듀서)\)|"
    r"\(노래\)|\(곡\)|\(앨범\)|\(싱글\)"
)
DISAMBIG_SUFFIX_RE = re.compile(
    r"\s*\((?:TVA|애니메이션|OVA|OAD|ONA|극장판|영화|TV|넷플릭스|\d{4}(?:년)?)\)\s*$"
)
SEASON_NOISE_RE = re.compile(
    r"\s*(?:Season\s*\d+|The\s+Final\s+Season|\d+(?:st|nd|rd|th)\s*Season|"
    r"第\s*\d+\s*[期季]|\d+\s*기|Part\s*\d+|Cour\s*\d+|"
    r"第[一二三四五六七八九十]+[期季]|[ⅡⅢⅣⅤ])\s*$",
    re.I,
)
FORMAT_LABEL = {
    "TV": "TV",
    "TV_SHORT": "TV",
    "MOVIE": "MOVIE",
    "OVA": "OVA",
    "ONA": "WEB",
    "SPECIAL": "SPECIAL",
}


def log(message: str) -> None:
    print(message, flush=True)


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def clean_html(value: str) -> str:
    value = TAG_RE.sub(" ", value or "")
    value = html.unescape(value)
    return SPACE_RE.sub(" ", value).strip()


def normalize_key(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).lower()
    return re.sub(r"[^0-9a-z가-힣ぁ-んァ-ヶー一-龯]", "", value)


def has_hangul(value: str) -> bool:
    return bool(HANGUL_RE.search(str(value or "")))


def hangul_ratio(value: str) -> float:
    text = str(value or "")
    meaningful = [ch for ch in text if ch.isalnum()]
    if not meaningful:
        return 0.0
    return sum(1 for ch in meaningful if HANGUL_RE.match(ch)) / len(meaningful)


def strip_disambig(title: str) -> str:
    title = SPACE_RE.sub(" ", str(title or "")).strip()
    title = re.sub(r"\s*-\s*나무위키\s*$", "", title).strip()
    # 문서 제목에 붙는 형식/원작 구분자는 표시 제목에서 제거합니다.
    title = re.sub(r"\s*\((?:애니메이션\s*(\d+기))\)\s*", r" \1", title)
    title = re.sub(r"\s*\(\d{4}\s*년?\s*애니메이션\)\s*", " ", title)
    title = re.sub(r"\s*\((?:애니메이션|TVA|OVA|OAD|ONA)\)\s*", " ", title)
    title = re.sub(
        r"\s*\((?:만화|웹툰|소설|게임|드라마|라이트\s*노벨|실사|영화)\)\s*$",
        "",
        title,
    )
    # 하위 문서(예: `작품/애니메이션`)는 작품 제목만 남깁니다.
    title = re.sub(
        r"\s*/\s*(?:애니메이션(?:\s*\d+기)?|TVA|OVA|ONA|극장판)\s*$", "", title
    )
    while True:
        new = DISAMBIG_SUFFIX_RE.sub("", title).strip()
        if new == title:
            break
        title = new
    return SPACE_RE.sub(" ", title).strip()


def season_number(value: str) -> int | None:
    raw_text = str(value or "")
    roman = re.search(r"[ⅡⅢⅣⅤ]", raw_text)
    if roman:
        return {"Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4, "Ⅴ": 5}[roman.group(0)]
    text = unicodedata.normalize("NFKC", raw_text)
    match = SEASON_NUMBER_RE.search(text)
    if not match:
        return None
    raw = match.group(1) or match.group(2)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def base_title_key(value: str) -> str:
    text = re.sub(r"[ⅡⅢⅣⅤ]", " ", str(value or ""))
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(
        r"\(\s*(?:애니메이션|TVA|OVA|OAD|ONA|극장판)?\s*\d*\s*(?:기|期|Season)?\s*\)",
        " ",
        text,
        flags=re.I,
    )
    text = re.sub(r"(?:Season|시즌|Part|Cour)\s*\d+", " ", text, flags=re.I)
    text = re.sub(r"第\s*\d+\s*[期季]", " ", text)
    text = re.sub(r"\d+\s*(?:기|期)", " ", text)
    text = re.sub(r"[()]", " ", text)
    text = re.sub(r"애니메이션|극장판|劇場版|映画", " ", text)
    text = re.sub(r"(?<!\d)\s*[2-9]$", "", text)
    return normalize_key(text)


def is_blocked_title(title: str, known_titles: list[str]) -> bool:
    title = str(title or "").strip()
    if not title or not has_hangul(title):
        return True
    if title in GENERIC_TITLES:
        return True
    if "/" in title:
        base, _, suffix = title.partition("/")
        suffix = suffix.strip()
        if not re.match(r"^(?:애니메이션(?:\s*\d+기)?|TVA|OVA|OAD|ONA|극장판)$", suffix):
            return True
        title = base.strip()
        if not title:
            return True
    if len(title) > 48:
        return True
    if BLOCK_TITLE_RE.search(title):
        # 실제 작품 제목이 차단어와 겹치는 경우(예: 게임 이름)는 알려진 제목이면 허용.
        if not any(normalize_key(title) == normalize_key(known) for known in known_titles):
            return True
    return False


def looks_like_person_document(doc: dict) -> bool:
    head = SPACE_RE.sub(" ", str(doc.get("og") or doc.get("section") or "")[:220]).strip()
    if not head:
        return False
    compact = SPACE_RE.sub("", head)
    if re.match(
        r"^(?:일본|대한민국|한국|미국|중국)의?"
        r"(?:성우|배우|가수|만화가|작가|감독|애니메이터|일러스트레이터|"
        r"프로듀서|각본가|작곡가|음악가|방송인|코미디언)",
        compact,
    ):
        return True
    if ANIME_TEXT.search(head):
        return False
    if re.search(r"배우|성우|가수|아이돌|방송인|만화가|작가|감독|프로듀서", head) and re.search(
        r"소속|출생|데뷔|본명|예명|신장|혈액형|생년월일", head
    ):
        return True
    return False


def looks_like_character_document(doc: dict) -> bool:
    """작품 문서가 아니라 등장인물/설정 문서인지 확인합니다."""
    head = SPACE_RE.sub(" ", str(doc.get("og") or doc.get("section") or "")[:160]).strip()
    if not head:
        return False
    if ANIME_TEXT.search(head) and not re.search(
        r"등장인물|캐릭터|주인공|악역|히로인", head
    ):
        return False
    if re.search(r"등장인물|캐릭터|주인공|히로인|악역", head):
        if not ANIME_STRONG.search(head):
            return True
        if re.search(r"(?:의|과|와)\s*(?:등장인물|캐릭터|주인공)", head):
            return True
    return False


def looks_like_program_block_document(doc: dict) -> bool:
    """작품이 아니라 심야 애니메이션 방송 시간대/블록 문서인지 확인합니다."""
    head = SPACE_RE.sub(" ", str(doc.get("og") or doc.get("section") or "")[:180]).strip()
    if not head:
        return False
    if re.search(
        r"(?:애니메이션|방송)\s*(?:방송\s*)?(?:시간대|블록|프로그램|편성)", head
    ) or re.search(r"방송\s*시간대", head):
        return not re.search(r"작품|애니메이션\s*영화|TVA|OVA", head)
    return False


def clean_body_text(value: str) -> str:
    text = clean_html(value)
    text = BRACKET_REF_RE.sub("", text)
    text = text.replace("[편집]", " ")
    text = NAV_RE.sub(" ", text)
    text = re.sub(r"자세한\s*내용은\s*.{0,80}?문서를?\s*참고하십시오\.?", " ", text)
    text = SPACE_RE.sub(" ", text).strip()
    return text


def first_sentence(text: str, limit: int = 260) -> str:
    head = SPACE_RE.sub(" ", str(text or "")[:limit]).strip()
    if not head:
        return ""
    return re.split(r"(?<=[.!?。])\s|(?<=다\.)\s|(?<=요\.)\s", head, maxsplit=1)[0]


def looks_like_source_work(text: str) -> bool:
    head = SPACE_RE.sub(" ", str(text or "")[:260]).strip()
    if not head:
        return False
    if SOURCE_WORK_TEXT.search(head) and not ANIME_STRONG.search(head):
        return True
    return False


def clip_overview(text: str, limit: int = 600) -> str:
    text = clean_body_text(text)
    if not text:
        return ""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    positions = [cut.rfind(mark) for mark in (". ", "다. ", "요. ", "! ", "? ")]
    last = max(positions)
    if last >= 160:
        cut = cut[: last + 1]
    return cut.strip() + "..."


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "template"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "template") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def strip_table_html(fragment: str) -> str:
    """개요 섹션 앞부분의 인포박스/이미지 캡션 표를 제거합니다."""
    previous = None
    while previous != fragment:
        previous = fragment
        fragment = re.sub(r"<table\b.*?</table>", " ", fragment, count=1, flags=re.S | re.I)
    return fragment


def extract_text(data: str, limit: int = 180_000) -> str:
    parser = TextExtractor()
    parser.feed(data)
    text = SPACE_RE.sub(" ", " ".join(parser.parts))
    return text[:limit]


def http_get(url: str, retries: int = 4, timeout: int = 40) -> str:
    last_error = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read().decode("utf-8", "replace")
        except Exception as error:  # noqa: BLE001
            last_error = error
            wait = 2 * (attempt + 1)
            if " 429" in str(error):
                wait = max(wait, 15)
            if attempt < retries - 1:
                time.sleep(wait)
    raise last_error  # type: ignore[misc]


def search(query: str) -> list[dict]:
    data = http_get(f"{BASE}/search/{urllib.parse.quote(query)}")
    results: list[dict] = []
    seen: set[str] = set()
    for raw_path, raw_title, raw_snippet in SEARCH_RE.findall(data):
        path = urllib.parse.unquote(raw_path)
        path = path if path.startswith("/w/") else "/w/" + path
        path_title = path[len("/w/") :].split("?")[0].replace("_", " ").strip()
        path_title = SPACE_RE.sub(" ", urllib.parse.unquote(path_title))
        if not path_title or path_title.startswith(BLOCKED_PATH_PREFIXES):
            continue
        if path in seen:
            continue
        seen.add(path)
        results.append(
            {
                "path": path,
                "pathTitle": path_title,
                "title": clean_html(raw_title),
                "snippet": clean_html(raw_snippet),
            }
        )
    return results


def fetch_document(path: str) -> dict:
    if not path.startswith("/w/"):
        path = "/w/" + path
    data = http_get(BASE + urllib.parse.quote(path, safe="/%"))
    title_match = TITLE_RE.search(data)
    title = clean_html(title_match.group(1)) if title_match else ""
    og_match = OG_RE.search(data)
    og = clean_html(og_match.group(1)) if og_match else ""
    og = re.sub(
        r"^(?:(?:파일|[가-힣A-Za-z]+):\S+\.(?:png|jpe?g|gif|webp)\s*)+",
        "",
        og,
        flags=re.I,
    ).strip()
    start = data.find("id='s-1'")
    end = data.find("id='s-2'", start + 1) if start > 0 else -1
    section = ""
    if start > 0:
        raw_section = data[start : end if end > start else start + 24_000]
        raw_section = strip_table_html(raw_section)
        raw_section = re.sub(r"<[^<>]*$", "", raw_section)
        section = clean_body_text(raw_section)
        section = re.sub(
            r"^\s*(?:id='s-1'[^>]*>\s*)?(?:\d+\.\s*)?개요\s*(?:\[편집\])?\s*",
            "",
            section,
        ).strip()
    body = extract_text(data)
    return {
        "title": title,
        "og": og,
        "section": section,
        "body": body,
        "path": path,
        "bytes": len(data),
    }


def media_titles(media: dict) -> dict:
    title = media.get("title") or {}
    return {
        "native": str(title.get("native") or "").strip(),
        "romaji": str(title.get("romaji") or "").strip(),
        "english": str(title.get("english") or "").strip(),
        "korean": str(media.get("koreanTitle") or "").strip(),
        "synonyms": [str(x or "").strip() for x in (media.get("synonyms") or [])],
    }


def original_keys(media: dict) -> list[str]:
    titles = media_titles(media)
    values = [titles["native"], titles["romaji"], titles["english"]]
    values.extend(titles["synonyms"])
    for value in list(values):
        cleaned = re.sub(
            r"\s*\((?:TV|TV_SHORT|ONA|OVA|OAD|MOVIE|SPECIAL|\d{4})\)\s*$",
            "",
            value,
            flags=re.I,
        ).strip()
        if cleaned and cleaned != value:
            values.append(cleaned)
        base = SEASON_NOISE_RE.sub("", value).strip()
        if base and base != value:
            values.append(base)
    keys: list[str] = []
    for value in values:
        key = normalize_key(value)
        if len(key) >= 3 and key not in keys:
            keys.append(key)
    return keys


def candidate_queries(
    media: dict, known_title: str = "", base_title: str = ""
) -> list[tuple[str, str]]:
    titles = media_titles(media)
    queries: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(value: str, kind: str) -> None:
        value = SPACE_RE.sub(" ", str(value or "")).strip()
        key = normalize_key(value)
        if len(key) < 2 or key in seen:
            return
        seen.add(key)
        queries.append((value, kind))

    def add_search(value: str, kind: str) -> None:
        add(value, kind)
        cleaned = re.sub(
            r"\s*\((?:TV|TV_SHORT|ONA|OVA|OAD|MOVIE|SPECIAL|\d{4})\)\s*$",
            "",
            SPACE_RE.sub(" ", str(value or "")).strip(),
            flags=re.I,
        )
        if cleaned and cleaned != value:
            add(cleaned, kind)

    season = season_number(
        " ".join([titles["native"], titles["romaji"], titles["english"]])
    )
    if base_title and season:
        # 같은 프랜차이즈의 이전 시즌 한국어 제목을 활용해 시즌 문서를 찾습니다.
        add(f"{base_title}(애니메이션 {season}기)", "base-ko-season")
        add(f"{base_title} {season}기", "base-ko-season")
        add(f"{base_title} Season {season}", "base-ko-season")
    if known_title:
        add(known_title, "known-ko")
    if titles["korean"]:
        add(titles["korean"], "anilist-ko")
    add_search(titles["native"], "native")
    add_search(titles["romaji"], "romaji")
    add_search(titles["english"], "english")
    for synonym in titles["synonyms"]:
        if has_hangul(synonym):
            add(synonym, "synonym-ko")
    if base_title and not known_title:
        add(base_title, "base-ko")
    return queries


def score_result(result: dict, media: dict, known_title: str) -> float:
    title = result.get("pathTitle") or result.get("title") or ""
    snippet = result.get("snippet") or ""
    anchor = result.get("title") or ""
    original = original_keys(media)
    query_key = normalize_key(result.get("query") or "")
    score = 0.0
    if not has_hangul(title):
        # 리다이렉트 문서는 링크 제목이 원제일 수 있습니다. 스니펫/원제 단서가
        # 있으면 실제 문서를 받아 한국어 제목을 확인합니다.
        if not has_hangul(snippet) and not (query_key and normalize_key(anchor) in original):
            return -100.0
        score -= 10.0
    else:
        if hangul_ratio(title) < 0.3:
            score -= 60.0
        if is_blocked_title(title, [known_title] if known_title else []):
            score -= 80.0
    normalized = normalize_key(title)
    if known_title:
        known_key = normalize_key(known_title)
        if normalized == known_key:
            score += 50.0
        elif known_key and (known_key in normalized or normalized in known_key):
            score += 18.0
    if query_key and normalized == query_key:
        score += 20.0 if has_hangul(result.get("query") or "") else 10.0
    if ANIME_TEXT.search(snippet):
        score += 10.0
    if re.search(r"등장인물|캐릭터|주인공|히로인", snippet):
        score -= 22.0
    if "원제" in snippet:
        score += 6.0
    if re.search(r"만화|원작|미디어\s*믹스", snippet):
        score += 5.0
    combined_key = normalize_key(f"{snippet} {anchor}")
    if any(key in combined_key for key in original):
        score += 22.0
    if query_key and normalize_key(anchor) in original:
        score += 8.0
    year = media.get("year")
    if isinstance(year, int):
        if str(year) in f"{title} {snippet}":
            score += 10.0
        elif str(year - 1) in f"{title} {snippet}" or str(year + 1) in f"{title} {snippet}":
            score += 5.0

    fmt = str(media.get("format") or "").upper()
    native_title = media_titles(media)["native"]
    is_movie_title = "극장판" in title or "劇場版" in native_title
    if fmt == "MOVIE":
        if is_movie_title:
            score += 12.0
        if season_number(title):
            score -= 15.0
    elif is_movie_title:
        score -= 35.0

    media_season = season_number(
        " ".join(
            [
                media_titles(media)["native"],
                media_titles(media)["romaji"],
                media_titles(media)["english"],
            ]
        )
    )
    doc_season = season_number(title)
    if media_season is not None:
        if doc_season == media_season:
            score += 16.0
        elif doc_season is not None and doc_season != media_season:
            score -= 30.0
        elif is_movie_title:
            score -= 20.0
    elif doc_season is not None and doc_season > 1:
        score -= 14.0

    year_in_title = re.search(r"\((\d{4})년", title)
    if year_in_title and isinstance(year, int):
        diff = abs(int(year_in_title.group(1)) - year)
        if diff <= 1:
            score += 6.0
        else:
            score -= 25.0
    return score


PROSE_START_RE = re.compile(
    r"(?:일본의\s*|대한민국의\s*|미국의\s*|중국의\s*)?"
    r"(?:라이트\s*노벨|만화|웹툰|소설|애니메이션(?:\s*영화|\s*시리즈)?|"
    r"게임|드라마|OVA|TVA)"
)


def prose_start(text: str) -> str:
    """이미지 캡션/일본어 태그라인 뒤의 실제 소개 문장부터 자릅니다."""
    text = re.sub(r"(?:일본판|한국판|영어판|원판|북미판)\s*로고", " ", text)
    text = re.sub(r"[^\s]+\.(?:png|jpe?g|gif|webp)\s*", " ", text, flags=re.I)
    text = SPACE_RE.sub(" ", text).strip(" .·-")
    match = PROSE_START_RE.search(text)
    if match and match.start() <= 320:
        prefix = text[: match.start()]
        # 앞부분이 한국어 문장이면 그대로 두고, 로고/일본어 태그라인일 때만 자릅니다.
        if prefix and (
            re.search(r"로고|파일:|\b[ぁ-んァ-ヶ一-龯]{4,}", prefix)
            or hangul_ratio(prefix) < 0.35
        ):
            return text[match.start() :].strip()
    return text


def overview_from_document(doc: dict) -> str:
    for raw in (doc.get("section"), doc.get("og")):
        text = clean_body_text(raw or "")
        text = re.sub(r"^\s*(?:\d+\.\s*)?개요\s*(?:\[편집\])?\s*", "", text).strip()
        text = prose_start(text)
        if len(text) < 40:
            continue
        if text.count("[편집]") > 1:
            continue
        if re.search(r"(?:^|\s)\d+\.\d+\.?\s", text):
            continue
        if hangul_ratio(text) < 0.25:
            continue
        if re.search(r"문서이다|문서로\s|설명하는\s*문서|설명하고\s*있는\s*문서", text[:200]):
            continue
        head = text[:400]
        if not ANIME_TEXT.search(head) or not ANIME_STRONG.search(head):
            continue
        if looks_like_source_work(text):
            continue
        overview = clip_overview(text, 600)
        if len(overview) >= 40:
            return overview
    return ""


def verify_document(
    media: dict,
    doc: dict,
    known_title: str,
    known_titles: list[str],
    strong_match: bool = False,
) -> dict | None:
    raw_title = doc.get("title") or ""
    title = strip_disambig(raw_title)
    if is_blocked_title(title, [known_title] if known_title else []):
        return None
    if not has_hangul(title) or hangul_ratio(title) < 0.3:
        return None
    # 한글이 괄호 안에만 있는 문서(예: 곡 문서 `오렌지(토라도라!)`)는
    # 괄호 앞부분이 실제 원제와 맞을 때만 작품 문서로 인정합니다.
    main_title = re.split(r"[(\[]", raw_title, maxsplit=1)[0]
    if not has_hangul(main_title):
        main_key = normalize_key(main_title)
        if not any(key and key in main_key for key in original_keys(media)):
            return None
    if looks_like_person_document(doc):
        return None
    if looks_like_character_document(doc):
        return None
    if looks_like_program_block_document(doc):
        return None
    fmt = str(media.get("format") or "").upper()
    native_title = media_titles(media)["native"]
    media_is_movie = "劇場版" in native_title or "映画" in native_title
    media_all_titles = " ".join(
        [
            media_titles(media)["native"],
            media_titles(media)["romaji"],
            media_titles(media)["english"],
        ]
    )
    # 최종 시즌/파트 문서는 같은 프랜차이즈의 포괄 문서(예: `진격의 거인`)로
    # 대체하지 않습니다. 문서 제목에도 최종/파트 표기가 있어야 합니다.
    if re.search(r"final\s*season|the\s*final\s*season|完結編|最終章", media_all_titles, re.I):
        if not re.search(r"final|파이널|최종|完結|완결", title, re.I):
            return None
    if re.search(r"part\s*[.\s]*[2-9]|第?\s*[2-9]\s*クール|後編", media_all_titles, re.I):
        if not re.search(r"part|파트|후편|전편|쿨|クール", title, re.I):
            return None
    if fmt == "MOVIE":
        if season_number(title) and not media_is_movie:
            return None
    else:
        if (title.startswith("극장판") or "극장판 " in title) and not media_is_movie:
            return None
        if title.endswith("극장판"):
            return None
    media_season = season_number(
        " ".join(
            [
                media_titles(media)["native"],
                media_titles(media)["romaji"],
                media_titles(media)["english"],
            ]
        )
    )
    doc_season = season_number(title)
    if media_season is not None and doc_season is not None and media_season != doc_season:
        return None
    if media_season is None and doc_season is not None and doc_season > 1:
        return None
    year_in_title = re.search(r"\((\d{4})년", title)
    year = media.get("year")
    if year_in_title and isinstance(year, int):
        if abs(int(year_in_title.group(1)) - year) > 1:
            return None
    evidence = " ".join(
        part for part in (doc.get("og") or "", doc.get("section") or "", doc.get("body") or "") if part
    )
    if not evidence:
        return None
    compact = normalize_key(evidence)
    keys = original_keys(media)
    if keys:
        intro = f"{doc.get('og') or ''} {doc.get('section') or ''}"
        intro_key = normalize_key(intro)
        if not any(key in intro_key for key in keys):
            if known_title or strong_match:
                # 문서 첫 문단에 원제가 없어도, 검색 단계에서 작품 문서로 강하게
                # 확인됐다면 본문(인포박스 포함)의 원제·연도로 검증합니다.
                if not any(key in compact for key in keys):
                    return None
            else:
                # 한국어 제목을 모르고 검색 근거도 약하면 첫 문단의 원제를 요구합니다.
                return None
    if not ANIME_TEXT.search(evidence):
        return None
    year_ok = False
    if isinstance(year, int):
        years = {str(year), str(year - 1), str(year + 1)}
        year_ok = any(value in evidence for value in years)
    if not year_ok:
        # 연도를 못 찾아도 알려진 한국어 제목과 문서 제목이 정확히 같으면 채택합니다.
        if not known_title or normalize_key(title) != normalize_key(known_title):
            return None
    overview = overview_from_document(doc)
    confidence = 0.7
    if known_title and normalize_key(title) == normalize_key(known_title):
        confidence = 0.88
    elif known_title and normalize_key(known_title) in compact:
        confidence = 0.8
    if year_ok:
        confidence += 0.04
    if overview:
        confidence += 0.03
    return {
        "title": title,
        "overview": overview,
        "confidence": round(min(confidence, 0.95), 2),
        "pageTitle": raw_title,
        "path": doc.get("path") or "",
    }


def harvest_media(
    media: dict | None,
    known_title: str,
    known_titles: list[str],
    max_doc_tries: int,
    sleep_seconds: float,
    base_title: str = "",
) -> dict:
    if not media:
        return {"status": "none", "reason": "media-not-found"}
    media_id = media.get("id")
    if not isinstance(media_id, int):
        return {"status": "none", "reason": "invalid-media"}
    queries = candidate_queries(media, known_title, base_title)
    if not queries:
        return {"status": "none", "reason": "no-query"}
    scored: dict[str, dict] = {}
    for query, kind in queries:
        try:
            results = search(query)
        except Exception as error:  # noqa: BLE001
            log(f"  search fail id={media_id} query={query!r}: {error}")
            time.sleep(sleep_seconds)
            continue
        time.sleep(sleep_seconds)
        for result in results:
            result["query"] = query
            result["queryKind"] = kind
            value = score_result(result, media, known_title)
            if value < -20:
                continue
            previous = scored.get(result["path"])
            if previous is None or value > previous["score"]:
                result["score"] = value
                scored[result["path"]] = result
        # 첫 검색에서 충분히 강한 후보가 있으면 추가 검색을 줄입니다.
        if any(item["score"] >= 50 for item in scored.values()):
            break
    ranked = sorted(scored.values(), key=lambda item: item["score"], reverse=True)
    tried = 0
    for result in ranked:
        if result["score"] < 8:
            break
        if tried >= max_doc_tries:
            break
        tried += 1
        try:
            doc = fetch_document(result["path"])
        except Exception as error:  # noqa: BLE001
            log(f"  doc fail id={media_id} path={result['path']!r}: {error}")
            time.sleep(sleep_seconds)
            continue
        time.sleep(sleep_seconds)
        original = original_keys(media)
        anchor_key = normalize_key(result.get("title") or "")
        path_key = normalize_key(result.get("pathTitle") or "")
        query_key = normalize_key(result.get("query") or "")
        snippet_key = normalize_key(
            f"{result.get('snippet') or ''} {result.get('title') or ''}"
        )
        strong_match = bool(
            (anchor_key and anchor_key in original)
            or (query_key and path_key == query_key)
            or (snippet_key and any(key in snippet_key for key in original))
            or (
                base_title
                and base_title_key(result.get("query"))
                and base_title_key(result.get("query"))
                == base_title_key(result.get("pathTitle"))
            )
        )
        verified = verify_document(
            media, doc, known_title, known_titles, strong_match=strong_match
        )
        if not verified:
            continue
        if is_franchise_base_match(
            {
                "matchedBy": f"{result['queryKind']}:{result['query']}",
                "kind": media.get("format"),
                "title": verified["title"],
            }
        ):
            log(f"  skip franchise-base id={media_id} title={verified['title']!r}")
            continue
        titles = media_titles(media)
        return {
            "status": "ok",
            "anilistId": media_id,
            "malId": media.get("idMal") if isinstance(media.get("idMal"), int) else None,
            "title": verified["title"],
            "overview": verified["overview"],
            "source": "namu",
            "confidence": verified["confidence"],
            "url": f"{BASE}{urllib.parse.quote(result['path'], safe='/%')}",
            "pageTitle": verified["pageTitle"],
            "matchedBy": f"{result['queryKind']}:{result['query']}",
            "kind": str(media.get("format") or ""),
            "year": media.get("year"),
            "nativeTitle": titles["native"],
            "score": round(result["score"], 2),
        }
    return {
        "status": "none",
        "anilistId": media_id,
        "reason": "no-verified-document",
        "candidates": [item["title"] for item in ranked[:3]],
    }


DERIVATIVE_FORMATS = {"OVA", "ONA", "SPECIAL"}


def is_franchise_base_match(item: dict) -> bool:
    """파생 작품(OVA/ONA/특별편)에 프랜차이즈 대표 문서 제목을 그대로 붙였는지 확인합니다.

    예: OVA `진격의 거인 외전`에 본편 문서 제목 `진격의 거인`을 붙이는 오매칭.
    한국어 제목이 문서 제목과 똑같이 남아 있고, 검색도 약한 `base-ko` 근거뿐이면
    그 작품 고유의 한국어 제목이 확인된 것으로 보지 않습니다.
    """
    matched = str(item.get("matchedBy") or "")
    if not matched.startswith("base-ko:"):
        return False
    if str(item.get("kind") or "").upper() not in DERIVATIVE_FORMATS:
        return False
    query = matched.split(":", 1)[1]
    return normalize_key(item.get("title")) == normalize_key(query)


def load_known_titles() -> tuple[dict[int, str], list[str], dict[int, dict]]:
    data = load_json(DB_JSON, {})
    by_id: dict[int, str] = {}
    values: list[str] = []
    entries: dict[int, dict] = {}
    for section in ("entries", "wikiEntries", "namuEntries"):
        for entry in (data.get(section) or {}).values():
            if not isinstance(entry, dict):
                continue
            title = str(entry.get("title") or "").strip()
            anilist_id = entry.get("anilistId")
            if isinstance(anilist_id, int):
                entries.setdefault(
                    anilist_id,
                    {
                        "title": title if title and has_hangul(title) else "",
                        "overview": str(entry.get("overview") or "").strip(),
                    },
                )
            if not title or not has_hangul(title):
                continue
            values.append(title)
            if isinstance(anilist_id, int):
                by_id.setdefault(anilist_id, title)
    return by_id, list(dict.fromkeys(values)), entries


def build_base_title_map(catalog: dict, known_by_id: dict[int, str]) -> dict[str, str]:
    """같은 원제를 쓰는 다른 시즌의 한국어 제목을 원제 기준으로 찾습니다."""
    result: dict[str, str] = {}
    for media in (catalog.get("media") or {}).values():
        if not isinstance(media, dict):
            continue
        korean = known_by_id.get(media.get("id"))
        if not korean:
            continue
        titles = media_titles(media)
        values = [titles["native"], titles["romaji"], titles["english"]]
        values.extend(titles["synonyms"])
        for value in values:
            key = base_title_key(value)
            if len(key) >= 3:
                result.setdefault(key, korean)
    return result


def find_base_title(media: dict, base_titles: dict[str, str]) -> str:
    titles = media_titles(media)
    values = [titles["native"], titles["romaji"], titles["english"]]
    values.extend(titles["synonyms"])
    for value in values:
        key = base_title_key(value)
        if len(key) >= 3 and key in base_titles:
            return base_titles[key]
    return ""


def is_metadata_complete(entry: dict | None) -> bool:
    if not entry:
        return False
    return bool(entry.get("title")) and len(str(entry.get("overview") or "")) >= 40


def select_media(args, catalog: dict, complete: dict[int, dict] | None = None) -> list[dict]:
    media_values = [m for m in (catalog.get("media") or {}).values() if isinstance(m, dict)]
    if args.ids:
        wanted = {int(value) for value in args.ids.split(",") if value.strip().isdigit()}
        media_values = [m for m in media_values if m.get("id") in wanted]
    else:
        formats = {value.strip().upper() for value in args.formats.split(",") if value.strip()}
        minimum = max(0, args.min_popularity)
        media_values = [
            m
            for m in media_values
            if (m.get("popularity") or 0) >= minimum
            and str(m.get("format") or "").upper() in formats
            and isinstance(m.get("year"), int)
        ]
        if not args.include_known and complete:
            media_values = [
                m for m in media_values if not is_metadata_complete(complete.get(m.get("id")))
            ]
        media_values.sort(key=lambda m: (m.get("popularity") or 0), reverse=True)
    if args.offset:
        media_values = media_values[args.offset :]
    if args.limit:
        media_values = media_values[: args.limit]
    return media_values


def save_output(path: Path, payload: dict) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
        newline="\n",
    )


def merge_into_db(items: dict[str, dict], dry_run: bool = False) -> dict:
    db = load_json(DB_JSON, {"version": 2, "entries": {}, "wikiEntries": {}})
    namu_entries = db.get("namuEntries")
    if not isinstance(namu_entries, dict):
        namu_entries = {}
        db["namuEntries"] = namu_entries
    added = 0
    updated = 0
    kept = 0
    pruned = 0
    # 이전 수확분에 남아 있는 프랜차이즈 대표 문서 오매칭을 정리합니다.
    for key in list(namu_entries):
        existing = namu_entries.get(key)
        if isinstance(existing, dict) and is_franchise_base_match(existing):
            del namu_entries[key]
            pruned += 1
    for item in items.values():
        if item.get("status") != "ok":
            continue
        if is_franchise_base_match(item):
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
            # 소개는 한국어가 확인된 경우에만 저장합니다.
            overview = ""
        url = str(item.get("url") or "").strip()
        if url and "namu.wiki/" not in url:
            continue
        entry = {
            "anilistId": anilist_id,
            "malId": mal_id,
            "title": title,
            "overview": overview,
            "source": "namu",
            "confidence": float(item.get("confidence") or 0.7),
            "url": url,
            "pageTitle": str(item.get("pageTitle") or "").strip(),
            "matchedBy": str(item.get("matchedBy") or "").strip(),
            "kind": str(item.get("kind") or "").strip(),
        }
        existing = namu_entries.get(key)
        if existing is None:
            namu_entries[key] = entry
            added += 1
            continue
        existing_has_overview = bool(str(existing.get("overview") or "").strip())
        new_has_overview = bool(overview)
        if new_has_overview and not existing_has_overview:
            namu_entries[key] = entry
            updated += 1
        elif entry["confidence"] > float(existing.get("confidence") or 0):
            namu_entries[key] = entry
            updated += 1
        else:
            kept += 1
    db["namuEntries"] = namu_entries
    db["namuCount"] = len(namu_entries)
    db["namuGeneratedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not dry_run:
        DB_JSON.write_text(
            json.dumps(db, ensure_ascii=False, indent=2),
            encoding="utf-8",
            newline="\n",
        )
    log(
        f"namuEntries merge: added {added}, updated {updated}, kept {kept}, "
        f"pruned {pruned}, total {len(namu_entries)}"
    )
    return db


def main() -> int:
    parser = argparse.ArgumentParser(description="나무위키 애니메이션 한국어 제목/소개 수확")
    parser.add_argument("--min-popularity", type=int, default=5000)
    parser.add_argument("--formats", default="TV,TV_SHORT,MOVIE,OVA,ONA,SPECIAL")
    parser.add_argument("--limit", type=int, default=0, help="0이면 전체")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--ids", default="", help="쉼표로 구분한 AniList ID")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--retry-none", action="store_true")
    parser.add_argument("--sleep", type=float, default=1.2)
    parser.add_argument("--max-doc-tries", type=int, default=3)
    parser.add_argument("--save-every", type=int, default=20)
    parser.add_argument("--no-merge", action="store_true")
    parser.add_argument("--merge-only", action="store_true")
    parser.add_argument(
        "--include-known",
        action="store_true",
        help="이미 제목/소개가 모두 있는 작품도 다시 수확합니다.",
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

    known_by_id, known_titles, complete = load_known_titles()
    base_titles = build_base_title_map(catalog, known_by_id)
    selected = select_media(args, catalog, complete)
    if not selected:
        log("No media selected.")
        return 1

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "namu.wiki",
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
    done = 0
    ok = 0
    skipped = 0
    started = time.time()
    log(
        f"harvest start: {total} media, minPopularity={args.min_popularity}, "
        f"formats={args.formats}, sleep={args.sleep}s"
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
        result = harvest_media(
            media,
            known_by_id.get(media_id, ""),
            known_titles,
            max(1, args.max_doc_tries),
            max(0.2, args.sleep),
            base_title=find_base_title(media, base_titles),
        )
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
            elapsed = time.time() - started
            log(f"  saved: {done}/{total}, ok={ok}, elapsed={elapsed/60:.1f}m")

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
