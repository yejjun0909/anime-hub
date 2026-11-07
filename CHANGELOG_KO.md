# 변경 내역

## v4.7.3 — 한국어 검색 인덱스 · 번역 커버리지 확대 (2026-11-07)

### 한국어 검색
- `data/korean-title-index.js`를 추가했습니다. 한국어 공통/검증 제목을 AniList 로마자·영어 제목과 연결해, “원령공주”처럼 한국어로 검색해도 AniList에 영어 제목으로 질의합니다.
- 띄어쓰기·문장부호·시즌 표기를 무시하는 정규화와 유사도 매칭을 적용했습니다. `진격거인`, `귀멸의 칼날 시즌2` 같은 입력도 찾습니다.
- 검색 자동완성에 한국어 제목 인덱스를 연결했습니다.
- 검색 결과가 없을 때 나무위키·구글 검색 링크를 제공합니다.

### 한국어 데이터
- 국내 통용 제목 시드를 65건 → 178건으로 늘렸습니다(AniList 100페이지 수확).
- `tools/merge_common_titles.py`로 수확 JSON 병합을 자동화했습니다(중복·카탈로그 중복 제외, MAL ID 정렬).
- `tools/build_title_index.py`로 한국어 제목 → AniList 검색어 인덱스를 재생성할 수 있습니다.
- `tools/build_korean_titles_db.py`에 `--start-page`, `--no-jikan` 옵션을 추가했습니다. Jikan이 차단된 환경에서도 AniList만으로 DB를 갱신할 수 있습니다.

### 검색 별칭
- `data/search-aliases.js`의 누락된 쉼표와 중복 항목을 정리했습니다. `tools/clean_search_aliases.py`로 재정리할 수 있습니다.
- 인기 검색어 59건, 동의어 79건을 유지합니다.

### 테마
- 첫 방문 시 운영체제의 라이트/다크 설정을 따르고, `theme-color` 메타 태그를 테마에 맞게 갱신합니다.
- 테마 버튼에 `aria-label`/`title`을 추가했습니다.

### 테스트
- `tests/korean-title-index.test.mjs`, `tests/korean-title-index.test.html`을 추가했습니다(17개 브라우저 검사).
- `tests/search-aliases.test.mjs`를 추가했습니다.

### 수정
- 단일 파일(`anime-hub-single.html`) 빌드에서 `search-aliases.js`, `korean-josa.js`가 빠져 자동완성·조사 처리에서 `ReferenceError`가 나던 문제를 고쳤습니다.
- `tools/build_single.py`가 `app.js`의 모든 import가 `MODULES`에 있는지 검사하도록 했습니다.

### 배포
- `tools/build_deploy_zip.py`를 추가했습니다. 사이트 실행 파일만 담은 `anime-hub-deploy.zip`을 재현 가능하게 만들 수 있습니다.
- `DEPLOY_NO_INSTALL_KO.md`에 Cloudflare Pages 절차를 추가했습니다.

### 버전
- `APP_VERSION` 4.7.3, `VERSION.txt` 4.7.3, PWA 셸 캐시 `anime-hub-shell-v4-7-3`.

## v4.7.2 — 애니허브 · 한국어 제목 확대 (2026-11-07)

### 이름
- 서비스 이름을 **애니허브**로 바꿨습니다. 화면 제목, 상단 로고(`애+`), PWA 이름, 알림, 오프라인 화면, 문서가 해당합니다.
- 호환을 위해 localStorage 키(`animehub_*`), 백업 파일의 `app: "ANIME HUB"` 값, 서비스 워커 캐시 접두사(`anime-hub-shell-`), Supabase 정책 이름은 바꾸지 않았습니다. 기존 보관함과 백업은 그대로 사용됩니다.

### 한국어 제목
- `data/korean-common-titles.js`를 추가했습니다. 국내에서 널리 쓰이는 대표작 65건의 한국어 표기를 MAL ID 기준으로 정리한 시드입니다.
- 우선순위가 가장 낮아서 수동 카탈로그, 사용자 입력, 사전 DB, TMDB, AniList/MAL 별칭, 나무위키/위키백과에서 제목이 확인되면 그쪽이 먼저 쓰입니다.
- 국내 플랫폼에서 직접 확인한 자료가 아니므로 화면에 "국내 통용 표기(자체 정리·플랫폼 미확인)"로 표시하고 공식 표기와 다를 수 있음을 안내합니다.
- MAL ID가 명시된 경우에만 매칭합니다. 숫자 id를 MAL ID로 추측하지 않습니다.
- 한국어 검색어 별칭을 52건, 인기 검색어를 15건 추가했습니다. (예: 데스노트, 약사의 혼잣말, 나 혼자만 레벨업)
- 인기 검색어에 섞여 있던 깨진 글자(`회옥옥折`)를 `회옥·옥절`로 고쳤습니다.
- `tests/korean-common-titles.test.mjs`를 추가했습니다.

## v4.7.1 — 안정화 패치 (2026-11-07)

- `robots.txt`, `sitemap.xml`, `offline.html` 끝에 섞여 있던 깨진 문자열(`""", "path">...`)을 제거했습니다.
- `tests/schedule-status.test.mjs`의 문법 오류(누락된 `test(` 선언)를 고쳐 테스트가 모두 실행되도록 했습니다.
- `npm test`를 `tools/run-tests.mjs`로 바꿨습니다. Node 22에서 `node --test tests/`가 실패하던 문제를 해결하고 Windows에서도 동작합니다.
- `setLoading()`이 로딩 중에 "조건에 맞는 작품이 없습니다"를 보여주던 버그를 고쳐 전달받은 안내 문구를 표시합니다.
- Gemini 기본 모델을 `gemini-2.5-flash`로 바꾸고 `animehub_gemini_model_v1`로 바꿀 수 있게 했습니다.

## v4.7.0 — 검증된 한국어 소스 · 일반 사이트 유지보수 (2026-11-04)

### 번역·한국어 데이터
- 사전 DB(`data/korean-titles-db.json`)에서 기계 번역 항목 71건을 `withheldTitle`로 분리하고 표시용 `title`을 비웠습니다. `policy: verified-only`, `verifiedCount: 32`를 기록합니다.
- `data/korean-titles-db.js`에 `VERIFIED_KOREAN_SOURCES`, `isVerifiedKoreanSource`, `filterVerifiedDb`를 추가해 로드·조회 단계에서 `google`/`gemini`/`none`을 차단합니다.
- `data/korean-query.js`를 추가했습니다. Gemini 응답은 나무위키 검색 후보로만 정규화되며 화면·캐시에 저장되지 않습니다.
- `data/korean-source.js`를 추가해 나무위키 → AI 후보 재검색 → 한국어 위키백과 순서를 한 곳에서 처리합니다. `app.js`는 더 이상 나무위키/위키백과/Gemini를 직접 호출하지 않습니다.
- 나무위키 연속 실패 시 10분 쿨다운을 적용해 불필요한 재시도와 콘솔 오류를 줄였습니다.
- `tools/build_korean_titles_db.py`를 확인된 출처(AniList/TMDB/MAL) 전용으로 정리하고, `tools/harvest_korean_titles.py`는 통합 래퍼로 변경했습니다.

### 일반 사이트 유지보수
- `tools/serve.py` 로컬 정적 서버 추가 (`Cache-Control: no-store`).
- `tools/build_single.py`를 저장소에 포함하고 `--check` 옵션을 추가했습니다.
- `package.json`에 `start`, `serve`, `build`, `validate` 스크립트를 추가했습니다.
- `sw.js`를 앱 코드 네트워크 우선으로 변경하고 캐시를 `anime-hub-shell-v4-7-0`으로 갱신했습니다. 새 모듈 `korean-query.js`, `korean-source.js`를 셸에 포함했습니다.
- `tools/check_korean_catalog.py`가 새 모듈 배선, 사전 DB 검증 장치, 단일 HTML 최신 여부를 검사합니다.

### 검증
- `tests/korean-source.test.mjs` 추가: 검증 출처 필터, 기계 번역 차단, AI 검색 후보 변환, 리졸버 순서/쿨다운/오류 처리.
- `tests/korean-source.test.html` 추가: 브라우저에서 동일 흐름을 수동 확인.
- `py tools/check_korean_catalog.py`와 `py tools/build_single.py --check`를 CI에 연결할 수 있도록 정리했습니다.

### 버전
- `APP_VERSION` 4.7.0, `VERSION.txt` 4.7.0, PWA 셸 캐시 `anime-hub-shell-v4-7-0`.
- 기존 localStorage 키와 사용자 데이터 형식은 유지했습니다.

## v4.6.0 — 데이터 기반 정리 (2026-11-03)

### 데이터 구조
- 수동 한국어 카탈로그 13건을 `data/korean-catalog.json`으로 분리했습니다. 레코드마다 `workId`, `anilistId`, `malId`, `tmdbId`, `checkedAt`, `status`, `sourceUrl`을 보관합니다.
- `tools/build_korean_catalog.py`로 JSON → `data/korean-catalog.js`를 생성하며, `--check`로 커밋 파일이 최신인지 검사합니다.
- `data/korean-match.js`가 AniList ID → workId → MAL ID 순으로 매칭하며, 제목만으로 작품을 연결하지 않습니다.
- `app.js`에서 `CURATED_KOREAN_OVERRIDES`/`CURATED_KOREAN_BY_MAL` 하드코딩을 제거했습니다.

### 버그 수정
- AniList 비교 연산자(`averageScore_greater` 등)에 `null`이 전달되면 400이 발생하던 문제를 수정했습니다. `data/api-vars.js`의 `pruneNullVariables`가 값 없는 필터를 요청에서 제거합니다.
- 검색 "귀멸의 칼날"이 이제 정상적으로 결과를 반환합니다.

### 검증
- ID 매칭 테스트 32건을 브라우저에서 실행, 32/32 통과.
- 백업/복원 E2E 리허설 통과 (내보내기 → 검사기 → 초기화 → 복원 → 토스트).
- 방영 일정 스냅샷 수집기(`tools/schedule_probe.py`) 추가, 7일 117건 수집.
- Supabase RLS 교차 접근 테스트 SQL 14건 추가.
- CI 스켈레톤(.github/workflows/ci.yml)과 Playwright 스모크 테스트 추가.

### 버전
- `APP_VERSION` 4.6.0, `VERSION.txt` 4.6.0, PWA 셸 캐시 `anime-hub-shell-v4-6-0`.
- `package.json` 추가 (type: module, scripts: check/test/verify). 기존 localStorage 키는 유지했습니다.

## v4.5.1 — 데이터 연결 보완 패치 (2026-11-03)
- 전체 백업 JSON의 `version` 값이 `4.4`로 남아 있던 문제를 수정했습니다. 이제 `4.5.1`을 기록합니다.
- 13개 수동 한국어 카탈로그 레코드를 AniList ID뿐 아니라 MyAnimeList/Jikan ID로도 찾도록 보완했습니다. Jikan 보조 결과로 열린 작품이나 `mal:` 형식으로 저장된 보관함 항목에서도 같은 한국어 제목·소개가 적용됩니다.
- 수동 한국어 자료 매칭 테스트를 위해 AniList ID ↔ MAL ID 매핑을 코드에 명시했습니다.
- PWA 셸 캐시를 v4.5.1로 갱신했습니다.
- 다음 버전 계획과 출시 전 품질 기준을 `ROADMAP_KO.md`에 정리했습니다.

## v4.5 — 한국어 작품 정보 정밀도 개선 (2026-11-03)

### 한국어 제목·소개 데이터 개선
- 작품 제목과 줄거리를 각각 독립적으로 판정합니다. 제목은 한국어인데 줄거리는 원문인 경우처럼 필드별로 출처가 다를 수 있습니다.
- 국내 서비스 카탈로그를 직접 대조해 정리한 대표작 한국어 자료 13개를 추가·확장했습니다. 진격의 거인, 귀멸의 칼날, 주술회전, 장송의 프리렌, 나의 히어로 아카데미아, 원피스, [최애의 아이], 체인소 맨, 나루토, 스파이 패밀리, 하이큐!!, 원펀맨, 블루 록이 포함됩니다.
- 수동 정리 자료는 출처 페이지로 이동할 수 있습니다. 줄거리는 플랫폼 문구를 그대로 복사하지 않고 핵심 내용을 짧게 다시 정리한 소개입니다.
- TMDB 검색 후보에 영어·사용자 선호 제목·로마자·일본어 원제와 AniList/MAL의 한글 별칭을 함께 활용합니다. 제목 일치도와 방영 연도를 비교해 다른 시즌·동명 작품을 잘못 연결할 가능성을 줄입니다.
- TMDB는 대한민국(ko-KR) 번역을 먼저 사용하고, 다른 지역의 한국어 번역은 국가 코드를 구분해 표시합니다.
- 추천 화면도 TMDB 토큰 유무와 관계없이 상위 8개 후보의 한글 별칭을 보조 조회하며, 요청량을 제한했습니다.
- TMDB 토큰이 없어도 AniList 한글 별칭과 Jikan/MAL의 한글 대체 제목을 조회할 수 있도록 했습니다.
- 한국어 별칭을 선택할 때 너무 짧은 약칭, 시즌 접미사, 긴 설명형 별칭을 함께 고려해 대표 제목에 가까운 항목을 우선하도록 개선했습니다.
- 상세 화면에서 제목 출처와 소개 출처를 각각 확인할 수 있습니다. 국내 카탈로그 기반으로 다시 정리한 소개는 TMDB 원문 소개와 구분해 표시합니다.
- 한국어 등록 소개가 없으면 원문 소개를 유지합니다. 자동 기계 번역으로 줄거리를 채우지 않습니다.
- 인물명·제작사명 등 고유명사도 표시용 기계 번역 캐시로 치환하지 않고 원래 이름을 유지합니다. 한국어 검색어의 검색 편의를 위한 입력어 번역만 남겼습니다.
- 오래된 한국어 메타데이터 부정 캐시를 초기화하도록 캐시 키를 갱신하고, PWA 셸 캐시를 v4.5로 변경했습니다.

### 기존 기능 유지
- 취향 추천, 보관함, 컬렉션, 통계, 작품 관계도, 알림, Supabase 계정별 동기화 기능을 유지합니다.
- 기존 보관함·컬렉션·저장 검색 조건의 localStorage 키는 변경하지 않았습니다.
- 설치 없는 정적 웹 배포 ZIP 형식을 유지합니다. Netlify 등 HTTPS 정적 호스팅에 올리면 PC·모바일 브라우저에서 바로 접속할 수 있습니다.

## v4.4 — 한국어 매칭 · 다중 사용자 · 모바일 설치
- TMDB 검색을 영어·로마자·일본어·등록 별칭으로 실행하고, 매칭한 작품의 한국어 상세·번역 정보를 따로 조회하도록 변경했습니다.
- AniList의 한글 별칭을 TMDB 토큰 없이도 사용하도록 수정했습니다.
- Supabase 계정 사용 시 보관함·컬렉션·저장 검색 조건을 계정별로 동기화합니다.
- PWA 매니페스트·아이콘·서비스 워커를 적용했습니다.

## v4.3.1 — 추천·한국어 데이터 정밀도 보완
- 장르·평점·시청 상태·형식·제작사 신호를 결합한 개인화 추천과 추천 이유를 표시합니다.
- TMDB의 한국어 번역 목록에서 대한민국(한국어) 번역을 우선 조회합니다.

## v4.3 — 추천 엔진 개선
- 높은 평점과 시청 완료 기록은 선호 신호, 낮은 평점과 하차 기록은 비선호 신호로 사용합니다.
- 여러 후보군을 모아 취향 점수로 다시 정렬하고 추천 근거를 표시합니다.
- 작품명·줄거리의 자동 기계 번역을 기본 표시에서 제거했습니다.

## v4.2 — 확장 기능
- 전체 작품 관계도, 인물 검색 분류, 무작위 발견, 향후 방영 회차 알림, 완료 화수·추정 감상 시간, JSON 백업·복원 기능을 추가했습니다.

## v4.1 이하
- 보관함·컬렉션 저장 안정성, 작품·인물 탐색, 방영 일정·필터·정렬, 반응형 화면과 캐시 최적화를 포함합니다.
