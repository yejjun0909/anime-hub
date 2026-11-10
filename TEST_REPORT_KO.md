# 애니허브 검사 보고서

## v4.8.0 국내 플랫폼 우선 한국어 메타데이터 (2026-11-11)
- `py tools/harvest_laftel.py --anilist-pages 12` 실행: AniList 인기 600작품의 한국어 별칭까지 후보로 확장한 시드 213개 중 미개봉 10건을 제외한 203작품 → **106건** 수확(라프텔 TV 86 / 영화 14 / ONA 5 / OVA 1). 줄거리 빈 항목 0건, 플랫폼 작품 중복 0건, AniList 중복 0건.
- 수확 매칭 결과: `exact-title+year` 83, `season-title+year` 21, `exact-title` 2. 미개봉 극장판(`마녀의 여행` 205444)은 제외하고 TV 112609만 유지. 인기 600작품으로 후보를 넓혀도 새로 연결된 작품은 없었고, 기존 1건의 매칭 방식만 `season-title+year` → `exact-title+year`로 정교해졌습니다.
- `py tools/build_korean_platform_catalog.py` → `data/korean-platform-catalog.js` 생성(106건, 약 121KB). `--check` 최신 상태 확인.
- `py tools/build_title_index.py` → 한국어 제목 인덱스 205 → **243건**(플랫폼 표기·기존 시드 별칭 38건 추가).
- `py tools/check_korean_catalog.py` → `OK: 카탈로그 13건, 경고 0건`.
- `py tools/build_single.py` → 단일 HTML 557,664 bytes 재생성, `--check` 최신 확인.
- 브라우저 확인(로컬 서버, Jikan 터널 차단 환경):
  - “귀멸의 칼날” 검색 → AniList 101922 상세에서 `제목: 라프텔`, `소개(플랫폼 등록): 라프텔`, 라프텔 줄거리 표시. 콘솔 오류 0건.
  - “진격의 거인 1기” 검색 → AniList 16498 상세에서 `제목: 라프텔` 표시.
  - “귀환자의 마법은 특별해야 합니다” 검색 → 플랫폼 작품 AniList 163142가 첫 결과로 나오고 상세에서 `제목: 라프텔`, `소개(플랫폼 등록): 라프텔` 표시(검색 인덱스 수정 확인).
  - “주술회전”은 라프텔 미보유 → 기존 수동 카탈로그(Apple TV 한국)로 폴백 확인.
  - 모듈형 사이트(`index.html`)와 단일 HTML 모두에서 확인. 콘솔 오류 0건.
- `tests/korean-platform.test.html` 브라우저 하네스 → **14/14 통과**. `tests/korean-platform.test.mjs`는 Node 환경용으로 함께 추가.
- Node.js가 없는 환경이라 `tests/korean-platform.test.mjs`를 포함한 `.mjs` 테스트는 CI/Node 환경에서 실행해야 합니다.

### 자체 검토 보완
- 검색 인덱스 충돌 수정: `귀환자의 마법은 특별해야 합니다`가 기존 MAL 57612/AniList 172192(2기)로 먼저 매핑되던 문제를 고쳐, 플랫폼이 확인한 MAL 54852/AniList 163142(1기)를 가리키도록 `tools/build_title_index.py`를 수정했습니다. 재생성 후 플랫폼 제목 누락 0건·AniList ID 불일치 0건(243건).
- 수확 검증 강화: `tools/harvest_laftel.py`가 한국어 줄거리가 없거나 비한국어인 항목을 제외하고, 재수확 시 라프텔 이외 플랫폼 레코드·플랫폼 목록을 보존하며, 기존 카탈로그 읽기 오류를 안전하게 처리합니다.
- 보조 조회 생략: `app.js`에서 플랫폼 자료가 있는 작품은 Jikan·TMDB·나무위키·한국어 위키백과 보조 조회를 건너뛰어 플랫폼 확인 값을 덮어쓰지 않습니다.
- 검사 강화: `tools/check_korean_catalog.py`가 `workId == anilist-<id>`와 플랫폼 제목의 검색 인덱스 연결 일치를 검사합니다.
- 회귀 테스트: `tests/korean-title-index.test.mjs`에 플랫폼 확인 제목이 AniList 163142를 가리키는 검사를 추가했습니다.
- `py -m py_compile tools/harvest_laftel.py tools/build_title_index.py tools/check_korean_catalog.py` 통과, `py tools/check_korean_catalog.py` → `OK: 카탈로그 13건, 경고 0건`.

## v4.7.4 자동 번역 미리보기·사용자 번역 백업 (2026-11-10)
- 설정 모달에서 `자동 번역 (선택)` 토글 표시, 기본값 꺼짐 확인. 토글 시 `animehub_machine_translate_enabled_v1` 저장 확인.
- 작품 상세에서 `자동 번역 보기 (비공식)` 버튼과 결과 블록(`자동 번역 · 비공식`, 엔진 표시) 확인. 공식 제목·소개 영역은 변경되지 않음.
- 자동 번역 결과가 공식 캐시(`animehub_korean_metadata_v3`)에 기록되지 않는지 확인.
- Google 번역 응답을 스텁으로 대체해 제목·소개 번역 UI가 정상 렌더링되는지 확인.
- 자동 번역 결과를 "내 한국어 자료로 저장"하면 `animehub_user_korean_v1`에 사용자 입력으로 저장되고, 상세 화면 제목·소개가 즉시 갱신되는지 확인.
- 저장한 한국어 제목이 검색 자동완성에 나타나고, 해당 제목으로 검색했을 때 AniList ID 조회로 작품이 다시 검색되는지 확인.
- 설정에서 `상세 화면에서 번역 결과 바로 표시`를 켠 뒤, 한국어 자료가 없는 작품을 열면 자동 번역 블록이 자동으로 표시되는지 확인(약 1.2초 후 시작, 공식 자료 확인 시 숨김).
- `tools/harvest_common_titles.py --sort`로 평점순·최신순을 추가 수확해 공통 제목 197건, 제목 인덱스 205건으로 갱신.
- `tests/machine-translate.test.mjs`, `tests/user-korean.test.mjs` 추가(Node.js 환경에서 실행).
- `py tools/check_korean_catalog.py` → `OK: 카탈로그 13건, 경고 0건`.
- `py tools/check_backup.py`로 `userKorean` 항목이 포함된 백업 형식을 검사(`OK: 복원 가능한 백업 형식입니다.`).
- `py tools/build_single.py --check` → `OK: anime-hub-single.html 최신`.
- 브라우저 콘솔 오류 0건(자동 번역 저장·검색 흐름, Jikan 터널 차단 환경 기준).

## v4.7.3 한국어 검색 인덱스·배포 (2026-11-07)
- `data/korean-title-index.js` 188개 항목 생성, 정확/퍼지 매칭 확인.
- 브라우저 테스트: `korean-title-index.test.html` 17/17, `korean-source.test.html` 18/18, `namu-fuzzy.test.html` 35/35, `id-match.test.html` 32/32 통과.
- 메인 앱 콘솔 오류 0건. 테마 토글(`light` 클래스, `theme-color` 갱신, `aria-label`)과 자동완성의 한국어 제목 노출 확인.
- 검색 “진격거인” → 인덱스가 `Attack on Titan`으로 질의, 20개 결과 표시 확인.
- 결과 없음 화면에서 나무위키·구글 검색 링크 표시 확인.
- 검증 DB 180건 로드, `lookupKoreanTitle({id:101922})` → `귀멸의 칼날` 반환 확인.
- 단일 파일 빌드 누락 모듈(`search-aliases.js`, `korean-josa.js`) 수정 후 단일 파일에서도 한국어 제목 질의·자동완성·콘솔 오류 0건 확인.
- `py tools/check_korean_catalog.py`, `py tools/build_single.py --check` 통과. 배포 ZIP 42개 파일 무결성(SW 셸·index 참조) 확인.
- 접근성·SEO 보강 확인: skip link, `<noscript>`, `main tabindex="-1"`, 검색/아이콘 버튼 `aria-label`, 탐색 메뉴 `aria-label`·`aria-current="page"`, `prefers-reduced-motion` 규칙, OG/Twitter/JSON-LD 존재. 경로 이동 시 `aria-current` 갱신 확인.
- Node.js가 없는 환경이라 `.mjs` 테스트는 CI에서 실행해야 합니다.

####### v4.9 추천 v2 (2차)
- `data/recommend-eval.js`에 `avgScore` 필드 추가, 추천 UI footnote에 다양성·평균 점수 표시.
- 브라우저 확인: 다양성 0.82 · 평균 점수 88.9.

## v4.9 추천 v2 (1차)
- `data/recommend-score.js` (점수 계산, 순위, 다양성 선택, 지표) + `data/recommend-eval.js` (precision/recall/NDCG/coverage/diversity/novelty/cold-start).
- 브라우저 테스트: `recommend-score.test.html` 6/6, `recommend-eval.test.html` 9/9.
- `scoreRecommendations` 리팩터링 → 모듈 사용 + MMR 다양성.

## v4.8 계정·동기화 하드닝 (2차)
- `showConflictModal` — 충돌 항목별 이 기기/클라우드 값 선택 UI.
- `replayQueuedMutations` — online 이벤트에서 큐 재전송 (idempotency, 5회 실패 시 드롭).
- `syncDelete` tombstone 우선 + 스키마 미적용 환경 hard delete 폴백.
- `syncUpsert` `deleted_at: null` (재추가 시 부활).

## v4.8 계정·동기화 하드닝 (1차)
- `data/sync-merge.js` (diff/merge + tombstone + 충돌 감지) + `data/sync-queue.js` (오프라인 큐, idempotency). 단위 테스트 4+3건, 브라우저 6+7건 통과.
- `supabase/migrations/0001_sync_hardening.sql` — `deleted_at`/`revision`/`client_id` 컬럼, 트리거, `anime_sync_mutations` 테이블, RLS.
- `app.js` — `getClientId()`, `syncUpsert`/`syncUserData`에 `client_id` 포함, tombstone 필터, `state.syncStatus` + 계정 버튼 표시.

##### v4.7 방영 일정 신뢰성 (4차)
- 시간대 선택기 (KST/UTC/로컬) 추가, `animehub_airing_tz_v1`에 저장.
- `airingTimeZone()` + `airingTimeZoneLabel()` 헬퍼, 렌더링에 동적 적용.

## v4.7 방영 일정 신뢰성 (3차)
- `renderAiring`에 "내 보관함만/전체 방영 일정" 토글 추가.
- `state.airingAllItems` 캐시 + `renderAiringView`로 재조회 없이 필터.
- 브라우저 확인: 토글 동작, 빈 보관함 시 빈 상태 표시, 오류 0건.

## v4.7 방영 일정 신뢰성 (2차)
- `classifyAiring`에 `HIATUS`(결방 의심), `MISSED`(미방영 의심) 상태 추가.
- 브라우저 테스트: `schedule-status.test.html` 9/9 통과.

## v4.7 방영 일정 신뢰성 (1차)
- `data/schedule-merge.js`, `data/schedule-cache.js`, `data/schedule-status.js` 추가.
- `renderAiring()` 3페이지(150건) 수집 + stale-while-revalidate 캐시 + baseline 기반 지연 의심 판정.
- 브라우저 테스트: `schedule.test.html` 11/11, `schedule-status.test.html` 7/7 통과.
- 실제 방영 일정 116건 렌더링, 캐시·baseline 정상 저장 확인.

## v4.6.0 — 데이터 기반 정리 (2026-11-03)

### ID 매칭 테스트
- `tests/korean-id-cases.json` 32건을 브라우저 하네스(`tests/id-match.test.html`)에서 실행 → **32/32 통과**.
- `tests/korean-catalog.test.mjs` — Node `node --test` 4개 그룹 통과(필수 필드, 유일성, 호환, 커버리지).
- `tools/check_korean_catalog.py` — OK, 경고 0건.
- 검증 항목: AniList ID 직접·문자열·공백, `media_id`, `idMal`, `mal_id`, `mal:`/`MAL:` 접두사, `workId`, AniList ID 우선, 시즌·극장판·후속작 오매칭 0건, 제목만으로 연결 금지, 숫자 ID를 MAL로 추측하지 않음.

### AniList 400 버그 수정
- 원인: `averageScore_greater: null` 등 비교 연산자에 null 전달 → "Illegal operator and value combination".
- `data/api-vars.js` `pruneNullVariables` + `app.js` `anilist()` 적용, `tests/api-vars.test.mjs` 4건 통과.
- 브라우저 E2E: 검색 "귀멸의 칼날" → POST 200, 카드 3종, 시즌별 소개 미상속 확인 (S1 curated, S2 AniList alias).

### 백업/복원 리허설
- `tools/check_backup.py` — 양성(`backup-valid.json`) 통과, 음성(`backup-invalid.json`) 6건 실패(의도된 동작).
- 브라우저 E2E: export → 다운로드 → 검사기 통과 → localStorage 초기화 → import → confirm → 정확히 복원(보관함 2, 컬렉션 1, 검색 1), 토스트 "백업 데이터를 복원했습니다."
- 음성 경로: 잘못된 파일 → "애니허브 백업 파일이 아닙니다", 기존 데이터 보존.

### 방영 일정 스냅샷
- `tools/schedule_probe.py` 실행, 7일 117건 수집, 3페이지. `data/schedule-snapshots/schedule-*.json` 저장.
- Jikan은 네트워크 차단으로 실패(환경 제한, 코드 오류 아님).
- 발견: `nextAiringEpisode`만 제공(지연 이력 없음), RELEASING/FINISHED만, MAL 매핑 누락 7건, duration 누락 24건.

### RLS 교차 접근 테스트
- `supabase/tests/rls_access_test.sql` — 계정 2개, 14개 시나리오. 실제 Supabase 계정 필요, 수동 실행 예정(v4.8).

### CI
- `.github/workflows/ci.yml`, `playwright.config.mjs`, `tests/e2e/smoke.spec.mjs` 추가.
- 로컬 Node 미설치로 `npm test` 미실행; CI 환경에서 실행 예정.

### 알려진 제한
- Node.js가 현재 환경 PATH에 없어 `node --check`와 `npm test`를 로컬에서 실행하지 못했습니다. 브라우저 스모크 테스트로 대체.
- `git` 미설치, 변경분은 커밋되지 않은 로컬 파일입니다.

## v4.5.1 검사 보고서
- `app.js`의 백업 JSON 버전이 `APP_VERSION`(4.5.1)을 사용하도록 수정.
- 13개 수동 한국어 레코드의 AniList ID ↔ MAL ID 매핑(13건) 정적 확인.
- AniList ID가 없는 `mal:` 작품도 MAL ID로 수동 한국어 자료를 찾는 경로 확인.
- `sw.js` 셸 캐시 이름을 v4.5.1로 갱신.
- `ROADMAP_KO.md` 추가 및 README/CHANGELOG 버전 표기 정리.
- 로컬 정적 서버 + Chromium 브라우저 스모크 테스트: 홈 화면 렌더링, 콘솔 문법 오류 없음.
- 검색 '귀멸의 칼날' → AniList ID `101922` 카드 선택 → 상세 화면에서 수동 한국어 제목·요약과 `Apple TV 한국 카탈로그 확인` 출처 표시 확인.
- `mal:38000` 보관함 fixture로 Jikan 경로를 재현해 카드 제목이 `귀멸의 칼날`로 표시되는지 확인.
- 설정 → 전체 백업 다운로드 JSON의 `version`이 `4.5.1`인지 확인.
- 참고: 현재 작업 환경에 Node.js가 없어 이번 패치에서는 `node --check`를 새로 실행하지 못했고, 브라우저 로드·기능 스모크 테스트로 대체했습니다. CI 환경에서는 `node --check`를 다시 실행해야 합니다.

## 이번 빌드에서 수행한 정적 점검
- (v4.5 빌드 기준) JavaScript 모듈 문법 검사(`node --check app.js`) 통과.
- `manifest.webmanifest` JSON 파싱 통과.
- HTML 기본 태그 구조 및 필수 정적 파일 존재 확인.
- PWA 서비스 워커 캐시 버전이 v4.5.1로 갱신되었는지 확인.
- TMDB 검색 후보에 영어·로마자·일본어·한글 별칭이 포함되고, 언어 스크립트에 맞는 검색 언어가 설정되는 코드 경로 확인.
- 한국어 제목 선택 우선순위(수동 확인 카탈로그 → TMDB → AniList → Jikan/MAL → 원제)와 한국어 소개 우선순위(수동 요약 → TMDB → Jikan/MAL → 원문)를 코드 정적으로 검토.
- 격리된 Node.js 모의 테스트에서 13개 수동 카탈로그 레코드, 진격의 거인 한글 제목 선택, 한국어 검색 언어 설정, 연도 기반 TV 시즌 오매칭 방지, 한글 별칭 우선순위를 확인했습니다.
- 화면의 작품명·줄거리·인물명·제작사명을 기계 번역으로 덮어쓰는 표시 경로를 제거하고, 검색 입력어 번역만 남겼는지 확인.
- 기존 보관함·컬렉션·저장 검색 localStorage key 유지 확인.
- HTML·JS·CSS·PWA 매니페스트·아이콘·Supabase SQL 및 배포 문서가 ZIP 루트에 포함되는지 확인.
- 로컬 정적 HTTP 서버에서 루트 페이지, `app.js`, `styles.css`, 매니페스트, 서비스 워커, 아이콘, Supabase SQL 요청이 모두 HTTP 200을 반환하는지 확인.
- 최종 배포 ZIP 무결성 검사 및 필수 파일 포함 여부 확인 통과.

## 실제 사용 테스트는 아직 수행하지 않음
- 사용자가 실제 브라우저에서 작품별 한국어 제목·소개를 확인하는 테스트는 아직 하지 않았습니다.
- 실제 TMDB 토큰을 이용한 서버 응답, Jikan 호출 제한, 실제 AniList 검색은 배포 환경에서 확인해야 합니다.
- Android/iOS 브라우저 설치·홈 화면 추가는 HTTPS 배포 후 확인해야 합니다.
- 실제 Supabase 프로젝트의 계정 간 RLS 권한 테스트는 수행하지 않았습니다.

## 한국어 데이터 품질 원칙
- 국내 플랫폼 카탈로그에서 확인해 정리한 자료와 커뮤니티 별칭을 구분합니다.
- AniList synonyms와 Jikan/MAL 제목 대체 항목은 국내 판권사의 공식 표기라고 단정하지 않습니다.
- TMDB 한국어 번역은 TMDB 등록 데이터이며 대한민국(`KR`) 지역 데이터가 있으면 우선합니다. 다른 지역의 한국어 번역일 경우 국가 코드를 구분합니다.
- 일부 수동 등록 줄거리는 국내 플랫폼 설명을 복사한 문장이 아니라 핵심 내용을 다시 정리한 요약입니다.
- 한국어 줄거리가 검증되지 않으면 자동 번역 대신 원문을 유지합니다.
- 모든 애니메이션의 국내 공식 한국어 명칭을 제공하는 하나의 공개 범용 API는 확인하지 못했습니다.

## 알려진 제한
- 수동 확인 카탈로그는 대표 작품 일부만 포함합니다. 전체 작품을 포괄하지 않습니다.
- TMDB 연결에는 각 이용자의 Read Access Token이 필요합니다. 브라우저에 공통 토큰을 노출하는 공개 배포는 권장하지 않습니다.
- Jikan은 MyAnimeList의 비공식 API입니다. 응답 제한·데이터 갱신 지연이 발생할 수 있습니다.
- AniList API 이용 약관은 경쟁 관계의 비보완형 애니메이션 목록/트래커 서비스 이용을 제한한다고 명시합니다. 공개 다중 사용자 서비스로 확장하기 전에 허가 및 약관 적합성을 확인해야 합니다.
