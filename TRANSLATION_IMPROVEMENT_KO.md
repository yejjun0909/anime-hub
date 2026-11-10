# 한국어 번역·메타데이터 전략 (v4.7.0)

## 결론

애니허브는 **“번역을 많이 하는 것”이 아니라 “확인된 한국어 자료를 정확히 표시하는 것”**을 목표로 합니다.

- 제목·줄거리·인물명·제작사명은 기본 표시에서 기계 번역하지 않습니다. 사용자가 설정에서 자동 번역을 명시적으로 켠 경우에만 상세 화면의 "자동 번역 · 비공식" 블록으로 미리 볼 수 있습니다.
- AI(Gemini)는 **나무위키 검색 후보(한국어 검색어)를 만드는 데** 사용하며, 자동 번역을 켠 경우 제목 번역에도 사용할 수 있습니다. AI가 만든 문장을 공식 메타데이터로 저장하지 않습니다.
- 실제 문서(나무위키·한국어 위키백과)나 등록된 출처(TMDB·AniList·MAL)가 확인된 경우에만 표시합니다.
- 확인된 자료가 없으면 원제/원문을 그대로 둡니다.

## 1. 왜 자동 번역을 표시용으로 쓰지 않는가

애니메이션 제목은 직역만으로 정할 수 없습니다. 국내 유통명, 방영 당시 제목, 플랫폼 등록 제목, 팬덤 약칭이 서로 다릅니다. 줄거리도 인명·고유명사·세계관 용어가 기계 번역에서 쉽게 바뀝니다. 자연스럽게 읽히더라도 국내 공식 소개나 판권사 설명으로 오인될 위험이 있습니다.

따라서 기계 번역은 **검색 보조**와, 사용자가 명시적으로 켠 **상세 화면의 비공식 미리보기**로만 쓰고, 공식 표시용 메타데이터와 분리합니다.

## 2. 표시 우선순위

### 제목

1. 국내 플랫폼 카탈로그에서 사람이 확인한 제목
2. 사용자 직접 입력
3. 확인된 한국어 사전 DB (`anilist`, `tmdb`, `mal` 등)
4. TMDB 한국어 번역 (대한민국 `ko-KR` 우선)
5. AniList 한글 별칭
6. MyAnimeList/Jikan 한글 대체 제목
7. 나무위키 문서 (best-effort)
8. 한국어 위키백과 문서 (애니메이션 문서로 확인된 경우)
9. 원제

### 줄거리

1. 국내 카탈로그 기반 요약
2. 사용자 직접 입력
3. 확인된 사전 DB의 한국어 소개
4. TMDB 한국어 소개
5. MAL/Jikan 한국어 소개
6. 나무위키·한국어 위키백과 문서 소개
7. 원문

## 3. 구현 구조

| 파일 | 역할 |
|---|---|
| `data/korean-titles-db.js` | 사전 DB에서 **검증된 출처만** 노출. `google`/`gemini`/`none` 차단 |
| `data/korean-query.js` | AI 응답을 나무위키 **검색 후보**로만 변환 |
| `data/korean-source.js` | 나무위키 → AI 후보 재검색 → 한국어 위키백과 순서의 통합 리졸버 |
| `data/namu-search.js` | 나무위키 best-effort 조회 + 실패 시 쿨다운 |
| `data/korean-wiki.js` | 한국어 위키백과 조회 (CORS `origin=*`) |
| `app.js` | 리졸버 결과를 캐시에 저장하고 상세/카드에 표시 |

### 처리 흐름

```text
원제
 ├─ 나무위키 직접 검색
 ├─ 실패 시: AI 한국어 검색 후보 생성 → 나무위키 재검색
 ├─ 실패 시: 한국어 위키백과 검색
 └─ 실패 시: 원제 유지
```

AI는 2번째 단계의 검색어로만 쓰입니다. `lookupKoreanSource()`는 AI 텍스트를 반환하지 않습니다.

## 4. 사전 DB 정책

`data/korean-titles-db.json`은 확인된 출처만 표시합니다.

- 허용: `anilist`, `tmdb`, `mal`, `jikan`, `namu`, `wiki`, `catalog`, `curated`, `manual`
- 차단: `google`, `gemini`, `machine`, `ai`, `auto`, `none`
- 기존 기계 번역 항목은 `title`을 비우고 `withheldTitle`로만 보관합니다.
- `data/korean-titles-db.js`의 `filterVerifiedDb()`가 로드·조회 시 한 번 더 차단합니다.

DB 재수집은 다음 명령을 사용합니다.

```bash
py tools/build_korean_titles_db.py --limit 500 --tmdb-token YOUR_TOKEN --resume
```

`tools/harvest_korean_titles.py`는 위 스크립트로 통합된 사용 중단 래퍼입니다.

## 5. 나무위키·한국어 위키백과 검증 기록 (2026-11-04)

### 나무위키

- `https://wiki-api.namu.la/api`: DNS/터널 실패
- `https://namu.wiki/api`: CORS 헤더 없음
- 나무위키는 MediaWiki가 아닌 자체 엔진(the seed)이라 표준 `api.php`도 없음
- 따라서 **best-effort**로만 시도하고, 연속 실패 시 쿨다운 후 다음 소스로 진행

### 한국어 위키백과

- Action API `origin=*`로 브라우저 직접 조회 가능
- `鬼滅の刃` → `귀멸의 칼날`
- `ぼっち・ざ・ろっく！` → `봇치 더 록!`
- `Sonny Boy` → 동명 문서의 한국어 소개 확인
- 동음이의 문서·비애니메이션 문서는 제외
- 소개는 600자로 제한

## 6. 유지보수 원칙

- 일반 사이트는 `index.html` + `app.js` + `data/*.js`를 기준으로 수정합니다.
- `anime-hub-single.html`은 `py tools/build_single.py`로만 갱신합니다.
- `py tools/build_single.py --check`와 `py tools/check_korean_catalog.py`로 생성 파일·배선·버전을 검사합니다.
- `sw.js`는 앱 코드(HTML/JS/CSS/JSON)를 네트워크 우선으로 가져와 수정 사항이 바로 반영됩니다.
- 새 한국어 소스를 추가할 때는 `data/korean-source.js`의 순서와 `KOREAN_DATA_POLICY_KO.md`를 함께 갱신합니다.

## 7. 향후 개선

1. 나무위키를 안정적으로 조회할 수 있는 승인된 API/서버 프록시 검토
2. 사용자가 제목·소개 수정 제안과 한국어 출처 URL을 제출하는 검토 흐름
3. 시즌·극장판·총집편에 원작 제목을 무조건 복사하지 않는 별도 제목 관리
4. 확인된 한국어 DB의 커버리지를 AniList ID·MAL ID 기준으로 확장
5. AI 검색 후보의 품질을 로그로 측정하되, 표시 데이터와는 계속 분리

## 8. 한국어 검색 인덱스 (v4.7.3)

한국어 제목을 **표시**하는 것과 별개로, 사용자가 한국어 제목으로 **검색**할 때 네트워크 질의어를 바꾸는 인덱스를 추가했습니다.

- `data/korean-title-index.js`: 한국어 공통/검증 제목 → `{ malId, anilistId, romaji, english, searchTerm }`
- `findKoreanTitleEntry(query)`: 정확 매칭 우선, 실패 시 유사도 0.72 이상 퍼지 매칭
- 정규화: 소문자·NFKC·공백/문장부호 제거·`시즌N`/`seasonN` 제거
- 이 인덱스는 **검색 질의 변환에만** 사용하며, 표시 제목의 출처가 아닙니다.
- 생성: `py tools/build_title_index.py`

### 커버리지 확장 기록

- AniList 인기순 1~100페이지 수확(2초 간격, 429 재시도)으로 공통 제목 178건 확보
- v4.7.4에서 평점순·최신순 수확을 추가해 공통 제목 197건으로 확대(즐겨찾기순은 중복만 확인)
- `py tools/merge_common_titles.py`로 수확 JSON 병합(카탈로그/기존 ID 제외, MAL ID 정렬)
- 인덱스 생성 결과 205개 항목(공통 제목 + 카탈로그)
- Jikan 차단 환경에서는 `py tools/build_korean_titles_db.py --limit 3000 --no-jikan --resume`로 AniList만 수집

## 9. 자동 번역 미리보기 (v4.7.4)

공식 한국어 자료가 없는 작품도 사용자가 원하면 번역을 미리 볼 수 있게 했습니다. 단, 공식 데이터와는 완전히 분리합니다.

- 설정 → **자동 번역 (선택)** 토글을 켜면 작품 상세에 `자동 번역 보기 (비공식)` 버튼이 활성화됩니다.
- **상세 화면에서 번역 결과 바로 표시**를 켜면, 자동 번역이 필요한 작품을 열었을 때 결과 블록이 자동으로 나타납니다.
- 제목이 원제로 표시되는 작품은 **자동 번역 제목**, 한국어 소개가 없는 작품은 **자동 번역 소개**를 별도 블록에 표시합니다.
- 결과에는 항상 `자동 번역 · 비공식` 배지와 사용 엔진(Google 번역 / Gemini AI)을 표시합니다.
- Gemini API 키가 있으면 제목 번역에 Gemini를 우선 사용하고, 없으면 Google 번역을 사용합니다. Google 번역이 실패하면 MyMemory를 보조로 사용합니다.
- 번역 결과는 `animehub_translation_ko_v1`/`animehub_machine_translate_v1`/`animehub_gemini_translate_v1` 캐시에만 보관하며, 공식 한국어 캐시(`animehub_korean_metadata_v3`)·검색 인덱스·백업에는 저장하지 않습니다.
- 확인한 번역은 **내 한국어 자료로 저장**할 수 있습니다. 저장하면 "사용자 입력"으로 표시되고, 해당 한국어 제목은 검색·자동완성에도 사용됩니다.
- 전체 백업에는 사용자가 직접 입력한 한국어 제목·소개(`animehub_user_korean_v1`)가 포함되어 다른 기기로 옮길 수 있습니다.

이 기능은 공식 표기가 아니므로, 정확한 제목은 상세 화면의 출처 링크에서 확인해야 합니다.
