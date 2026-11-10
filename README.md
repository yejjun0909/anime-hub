# 애니허브 v4.8.0

PC와 모바일 브라우저에서 사용하는 애니메이션 정보·시청 관리 웹앱입니다. 작품 검색, 한국어 메타데이터, 개인 취향 추천, 보관함과 컬렉션을 한 곳에서 관리합니다.

이 버전부터는 **`index.html`을 중심으로 한 일반적인 정적 사이트**를 기본으로 유지합니다. `anime-hub-single.html`은 CSS·JS·데이터를 하나로 묶은 오프라인/보관용 사본이며, 배포나 개발의 기준 파일이 아닙니다.

## 빠른 시작 (로컬)

정적 사이트이므로 빌드 과정 없이 파일을 열어도 되지만, 서비스 워커와 모듈 import를 정상적으로 확인하려면 로컬 서버를 사용하세요.

```bash
py tools/serve.py
# http://127.0.0.1:8123/
```

Node.js가 있다면:

```bash
npm run serve
```

> 개발 편의를 위한 Python/Node.js 사용이며, 사이트 이용자에게 설치를 요구하지 않습니다.

## 주요 기능

- 홈, 방영 일정, 전체 애니, 극장판·영화, 제작사, 성우·스태프 탐색
- 작품 상세, 전작·후속작·외전·스핀오프 관계도
- 완결·장르·국가·연도·화수·평점·형식 필터와 정렬
- 볼 예정·시청 중·시청 완료·보류·하차 상태의 보관함
- 개인 평점, 컬렉션, 전체 JSON 백업·복원
- 장르·평점·시청 상태·형식·제작사 기반 설명 가능한 취향 추천
- 새 작품 및 예정 회차 알림(브라우저가 실행 중일 때)
- 시청 상태·완료 화수·추정 감상 시간 통계
- 반응형 모바일 화면 및 PWA 홈 화면 추가
- 선택형 Supabase 로그인 및 기기 간 개인 데이터 동기화

추천은 보관함 기반 규칙형 추천입니다. 개인 기록을 반영하지만 머신러닝이나 집단 협업 필터링은 아닙니다.

## 한국어 제목·줄거리 전략

애니허브는 “모든 것을 한국어처럼 보이게 만드는 것”보다 **확인 가능한 출처를 한국어로 정확히 표시하는 것**을 우선합니다. 제목과 줄거리는 서로 독립적으로 판정합니다.

### 표시 우선순위

국내 애니 정보 사이트를 먼저 참고하고, 없을 때만 다음 소스로 내려갑니다.

1. **국내 플랫폼 카탈로그** (`data/korean-platform-catalog.json`): 라프텔 → 애니플러스 → 왓챠 → 티빙 → 웨이브 → 넷플릭스 KR → 쿠팡플레이 → 디즈니+ KR 순으로 확인된 제목·소개. 현재 자동 수확은 라프텔만 지원합니다.
2. **수동 카탈로그** (`data/korean-catalog.json`): Apple TV KR 등 사람이 직접 확인해 정리한 13건. 플랫폼 카탈로그에 없는 작품의 다음 순위입니다.
3. 사용자가 직접 입력한 한국어 자료
4. 확인된 한국어 사전 DB (`data/korean-titles-db.json`)
5. TMDB 한국어 번역 (대한민국 `ko-KR` 우선)
6. AniList 한글 별칭
7. MyAnimeList/Jikan 한글 대체 제목
8. 나무위키 문서 (best-effort)
9. 한국어 위키백과 문서 (CORS 허용, 애니메이션 문서로 확인된 경우)
10. 국내 통용 표기 시드 (`data/korean-common-titles.js`, 플랫폼 미확인으로 표시)
11. 원제 또는 원문 소개

플랫폼 카탈로그는 **AniList ID → workId → MAL ID** 순으로만 연결합니다. 제목이 비슷하다는 이유만으로 연결하지 않으며, 정규화한 제목이 같고 (연도를 알 수 있으면) 연도 차이가 1년 이내일 때만 수확합니다. 수확된 소개는 플랫폼이 등록한 문장을 그대로 사용하고 화면에 `소개(플랫폼 등록)`·`라프텔 출처`로 표시합니다.

### 기계 번역과 AI의 역할

- 공식 한국어 자료가 없을 때, 사용자가 설정에서 **자동 번역(선택)** 을 켜면 작품 상세에서 제목·소개를 기계 번역으로 미리 볼 수 있습니다. 결과에는 항상 "자동 번역 · 비공식" 배지가 붙고, 공식 메타데이터·검색 색인·백업에는 저장되지 않습니다. 확인한 번역은 "내 한국어 자료로 저장"할 수 있으며, 저장한 한국어 제목은 검색·자동완성에도 사용됩니다.
- 설정에서 **상세 화면에서 번역 결과 바로 표시**를 켜면 자동 번역이 필요한 작품을 열 때 결과 블록이 자동으로 나타납니다.
- Gemini는 **나무위키 검색 후보(한국어 검색어)를 만드는 데** 사용하며, 자동 번역을 켠 경우 제목 번역에도 사용할 수 있습니다. AI/기계 번역 결과를 공식 출처로 승격하지 않습니다.
- AI 후보로 나무위키를 재검색했더라도, 실제 문서가 확인된 경우에만 해당 문서의 제목·소개를 사용합니다.
- 사전 DB에 남아 있는 기계 번역 항목은 `data/korean-titles-db.js`의 검증 필터에서 제외됩니다. 원본 JSON에는 감사·재검토용으로 `withheldTitle`만 남기고 표시용 `title`은 비웁니다.
- 검색은 정확히 같은 이름이 아니어도 유사한 이름을 찾도록 퍼지 매칭을 사용합니다.
- 한국어 제목 인덱스(`data/korean-title-index.js`)는 한국어 제목을 AniList 영어/로마자 제목으로 바꿔 조회합니다. 이 인덱스는 검색 질의 변환에만 쓰이며 표시 출처가 아닙니다.

자세한 기준은 `KOREAN_DATA_POLICY_KO.md`, 구현 배경은 `TRANSLATION_IMPROVEMENT_KO.md`를 참고하세요.

### 데이터 출처

- AniList GraphQL: 작품·방영·장르·제작사·인물·관계 데이터와 일부 한글 별칭
- Jikan / MyAnimeList: 보조 평점·순위·일부 작품 정보·한글 대체 제목. Jikan은 MyAnimeList의 비공식 API입니다.
- TMDB: 선택 연결 시 한국어 제목·줄거리·작품별 번역 정보
- 국내 서비스 카탈로그: 라프텔 등 국내 플랫폼에서 직접 확인한 제목·줄거리(자동 수확), Apple TV KR 등 수동 확인 자료
- 나무위키 / 한국어 위키백과: 확인된 문서의 제목·소개 (best-effort)

API 응답과 데이터 범위는 각 제공처의 갱신 시점, 요청 제한, 서비스 상태에 영향을 받습니다.

## 사이트 유지보수

### 파일 구조

```text
anime-hub/
├── index.html                  # 일반 사이트 진입점
├── app.js                      # 앱 로직
├── styles.css
├── sw.js                       # 서비스 워커 (앱 코드 네트워크 우선)
├── manifest.webmanifest
├── data/
│   ├── korean-catalog.json     # 수동 확인 한국어 카탈로그 원본
│   ├── korean-catalog.js       # 위 JSON에서 생성
│   ├── korean-match.js         # ID 기반 카탈로그 매칭
│   ├── korean-platform-catalog.json # 국내 플랫폼(라프텔) 수확 원본
│   ├── korean-platform-catalog.js   # 위 JSON에서 생성
│   ├── korean-platform-match.js     # 플랫폼 우선순위·ID 기반 매칭
│   ├── korean-titles-db.json   # 사전 계산 한국어 제목 DB
│   ├── korean-titles-db.js     # 검증된 출처만 노출
│   ├── korean-common-titles.js # MAL ID 기준 국내 통용 표기 시드
│   ├── korean-title-index.js   # 한국어 제목 → AniList 검색어 인덱스(생성 파일)
│   ├── korean-query.js         # AI 검색 후보 생성 (표시용 아님)
│   ├── korean-source.js        # 나무위키 → 위키백과 통합 리졸버
│   ├── namu-search.js
│   ├── korean-wiki.js
│   └── ...                     # 일정·추천·동기화 모듈
├── tools/
│   ├── serve.py                # 로컬 정적 서버
│   ├── build_single.py         # 단일 HTML 생성/검사
│   ├── build_korean_catalog.py
│   ├── build_korean_platform_catalog.py # 플랫폼 카탈로그 JSON → JS 생성
│   ├── harvest_laftel.py       # 라프텔 검색/상세 수확 (제목·연도 검증)
│   ├── build_korean_titles_db.py
│   ├── build_title_index.py    # 한국어 제목 인덱스 생성
│   ├── merge_common_titles.py  # 수확 JSON → 공통 제목 병합
│   ├── build_deploy_zip.py     # 배포용 ZIP 생성
│   ├── build_deploy_dir.py     # 자동 배포용 _site/ 생성
│   ├── build_site.py           # 자동 배포 산출물 일괄 생성
│   ├── deploy_files.py         # 배포 포함 파일 목록
│   ├── check_korean_catalog.py
│   └── ...
├── tests/
│   ├── *.test.mjs              # Node 단위 테스트
│   ├── *.test.html             # 브라우저 수동 테스트
│   └── e2e/
├── anime-hub-single.html       # 생성된 단일 파일 사본
└── supabase/
```

### 자주 쓰는 명령

```bash
# 로컬 서버
py tools/serve.py
# 같은 Wi-Fi의 휴대폰에서 접속 (PC가 켜져 있을 때만)
py tools/serve.py --lan

# 한국어 카탈로그 JSON → JS 생성
py tools/build_korean_catalog.py

# 라프텔 국내 카탈로그 수확 → data/korean-platform-catalog.json
py tools/harvest_laftel.py
# AniList 인기 작품의 한국어 별칭까지 후보로 확장 (12페이지 = 600작품)
py tools/harvest_laftel.py --anilist-pages 12
# 수확 JSON → 브라우저용 모듈 생성 / 최신 여부 검사
py tools/build_korean_platform_catalog.py
py tools/build_korean_platform_catalog.py --check

# 사전 제목 DB 재수집 (확인된 출처만)
py tools/build_korean_titles_db.py --limit 500 --tmdb-token YOUR_TOKEN --resume

# Jikan이 차단된 환경에서 AniList만으로 재수집
py tools/build_korean_titles_db.py --limit 3000 --no-jikan --resume

# AniList 수확 JSON 병합 → 공통 제목 확장
py tools/merge_common_titles.py data/korean-common-titles.harvest*.json

# 한국어 제목 → AniList 검색어 인덱스 재생성
py tools/build_title_index.py

# 사전 DB에서 빈 항목 정리
py tools/prune_korean_titles_db.py

# 배포용 ZIP 생성 (사이트 실행 파일만 포함, 수동 업로드용)
py tools/build_deploy_zip.py

# 자동 배포용 산출물 생성 (GitHub Pages / Netlify / Cloudflare Pages)
py tools/build_site.py

# 단일 HTML 재생성 / 최신 여부 검사
py tools/build_single.py
py tools/build_single.py --check

# 전체 정적 검증 (카탈로그 + 배선 + 단일 파일 최신 여부)
py tools/check_korean_catalog.py

# Node 테스트 (Node.js 20+)
npm test

# Node.js가 없을 때: 로컬 서버에서 브라우저 테스트 페이지 열기
# http://127.0.0.1:8123/tests/korean-platform.test.html
# http://127.0.0.1:8123/tests/id-match.test.html
```

### 캐시와 버전

- `sw.js`는 HTML·JS·CSS·JSON을 **네트워크 우선**으로 가져옵니다. 앱 코드를 수정하면 새로고침만으로 반영됩니다.
- 이미지·아이콘은 캐시 우선입니다.
- 버전을 올릴 때는 `app.js`의 `APP_VERSION`, `VERSION.txt`, `sw.js`의 `CACHE_NAME`, `package.json`의 `version`을 함께 맞춥니다. `py tools/check_korean_catalog.py`가 불일치를 검사합니다.

## 데이터 저장과 계정

- 기본 저장은 현재 브라우저의 localStorage입니다. 다른 기기와 자동으로 공유되지 않습니다.
- 기기 간 동기화에는 Supabase 프로젝트 URL과 공개용 publishable/anon key, 각 기기의 동일 계정 로그인이 필요합니다.
- 여러 사람은 각자 다른 Supabase 계정으로 로그인합니다. RLS 정책은 사용자의 보관함·컬렉션·검색 데이터를 계정별로 분리합니다.
- 최신 `supabase/schema.sql` 전체를 Supabase SQL Editor에서 적용해야 합니다.
- `service_role` 키는 절대 브라우저에 입력하거나 공개하지 마세요.
- Jikan 전용 작품(`mal:` ID)은 현재 보관함 클라우드 동기화에서 제외됩니다.
- 설정의 전체 백업 기능으로 보관함·컬렉션·저장 검색 조건을 JSON으로 내려받을 수 있습니다.

## API 약관 유의 사항

AniList는 API 이용 약관에서 경쟁 관계에 있는 비보완형 애니메이션/만화 목록·트래커 서비스에 대한 API 사용을 제한한다고 명시합니다. 사용 범위를 넓히기 전에 현재 약관과 허가 필요 여부를 확인해야 합니다: https://docs.anilist.co/guide/terms-of-use/

## PWA와 모바일

Android Chrome 및 iPhone Safari에서 일반 웹사이트로 이용할 수 있습니다. 원한다면 홈 화면에 추가해 앱처럼 사용할 수 있습니다. 서비스 워커는 앱 셸과 최근 포스터 이미지를 캐시하며, 외부 API 조회에는 인터넷 연결이 필요합니다.

PC가 꺼져 있어도 모바일에서 계속 쓰려면 HTTPS 정적 호스팅에 한 번 배포해야 합니다. Git 저장소를 연결하면 푸시할 때마다 자동 배포되므로 ZIP을 다시 올릴 필요가 없습니다: [DEPLOY_AUTO_KO.md](DEPLOY_AUTO_KO.md).
