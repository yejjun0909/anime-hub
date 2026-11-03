# ANIME HUB v4.6.0

PC와 모바일 브라우저에서 사용하는 애니메이션 정보·시청 관리 웹앱입니다. 별도 플레이어가 아니라 작품 검색, 한국어 메타데이터, 개인 취향 추천, 보관함과 컬렉션을 한 곳에서 관리하는 데 집중합니다.

> v4.6.0은 v4.5.1의 데이터 연결 보완 패치 위에 **데이터 기반 정리** 릴리스입니다. 수동 한국어 카탈로그를 `data/korean-catalog.json`으로 분리하고, AniList 비교 연산자 null 오류를 고쳐 검색이 정상 동작하도록 했습니다. 다음 단계 계획과 출시 전 품질 기준은 `ROADMAP_KO.md`를 참고하세요.

## 사용 방법: 별도 설치 없는 웹

이 릴리스는 정적 웹 배포용입니다. 이용자 기기에 Python, Node.js, 별도 프로그램을 설치할 필요가 없습니다.

1. ZIP 압축을 풉니다.
2. [Netlify Drop](https://app.netlify.com/drop) 등에 `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `_headers`, `assets` 폴더가 바로 보이는 폴더를 업로드합니다.
3. 생성된 HTTPS 주소를 PC 또는 스마트폰 브라우저에서 엽니다.

처음 한 번 호스팅 계정과 파일 업로드는 필요합니다. 업로드 후에는 앱 사용자들이 웹 주소만으로 접속할 수 있습니다. 자세한 절차는 `DEPLOY_NO_INSTALL_KO.md`를 참고하세요.

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

## 한국어 제목·줄거리 정책

제목과 줄거리는 서로 독립적으로 출처를 확인합니다. 작품 제목이 한국어로 확인되더라도 줄거리가 없으면 원문을 유지할 수 있습니다.

### 제목 표시 우선순위

1. 국내 플랫폼 카탈로그에서 확인해 정리한 대표 작품 데이터
2. TMDB에 등록된 한국어 현지화 제목(대한민국 `ko-KR` 우선)
3. AniList의 한글 별칭
4. MyAnimeList/Jikan의 한글 대체 제목
5. 원제 그대로 표시

### 줄거리 표시 우선순위

1. 국내 플랫폼 카탈로그를 대조해 직접 정리한 요약 소개
2. TMDB에 등록된 한국어 소개
3. 실제 한국어로 등록된 Jikan/MAL 소개
4. 한국어 소개가 없으면 원문 표시

작품명·줄거리·인물명·제작사명은 화면 표시를 위해 기계 번역하지 않습니다. 한국어 검색어를 외부 검색어로 바꾸는 입력 보조 번역만 사용합니다.

국내 카탈로그를 확인해 직접 정리한 자료에는 출처 링크가 있습니다. 일부 작품 소개는 플랫폼 문장을 복사하지 않은 요약입니다. v4.5에는 진격의 거인, 귀멸의 칼날, 주술회전, 장송의 프리렌, 나의 히어로 아카데미아, 원피스, [최애의 아이], 체인소 맨, 나루토, 스파이 패밀리, 하이큐!!, 원펀맨, 블루 록이 포함됩니다.

AniList·MAL의 별칭은 커뮤니티 대체 제목이며 판권사의 공식 표기라고 보장할 수 없습니다. TMDB 번역도 TMDB에 등록된 현지화 자료로 국내 판권사·방송사의 최종 표기와 다를 수 있습니다. 모든 애니메이션의 국내 공식 한국어 제목·소개를 제공하는 단일 공개 API는 확인하지 못했습니다.

### TMDB 연결

TMDB 한국어 데이터 범위를 넓히려면 설정 → 데이터·계정 설정 → 한국어 작품명·줄거리 정보에서 TMDB v4 Read Access Token을 등록하세요. 토큰은 해당 브라우저의 로컬 저장소에 보관됩니다. 토큰이 없어도 국내 수동 정리 자료와 AniList/Jikan의 한글 별칭은 사용할 수 있습니다.

공개 다중 사용자 서비스에서 공통 토큰을 브라우저에 넣으면 토큰이 이용자에게 노출됩니다. 여러 이용자가 공통 토큰을 써야 한다면 서버 프록시가 필요합니다.

## 데이터 저장과 계정

- 기본 저장은 현재 브라우저의 localStorage입니다. 다른 기기와 자동으로 공유되지 않습니다.
- 기기 간 동기화에는 Supabase 프로젝트 URL과 공개용 publishable/anon key, 각 기기의 동일 계정 로그인이 필요합니다.
- 여러 사람은 각자 다른 Supabase 계정으로 로그인합니다. RLS 정책은 사용자의 보관함·컬렉션·검색 데이터를 계정별로 분리합니다.
- 최신 `supabase/schema.sql` 전체를 Supabase SQL Editor에서 적용해야 합니다.
- `service_role` 키는 절대 브라우저에 입력하거나 공개하지 마세요.
- Jikan 전용 작품(`mal:` ID)은 현재 보관함 클라우드 동기화에서 제외됩니다.
- 설정의 전체 백업 기능으로 보관함·컬렉션·저장 검색 조건을 JSON으로 내려받을 수 있습니다.

## API 및 데이터 출처

- AniList GraphQL: 작품·방영·장르·제작사·인물·관계 데이터와 일부 한글 별칭
- Jikan / MyAnimeList: 보조 평점·순위·일부 작품 정보·한글 대체 제목. Jikan은 MyAnimeList의 비공식 API입니다.
- TMDB: 선택 연결 시 한국어 제목·줄거리·작품별 번역 정보
- 국내 서비스 카탈로그: 대표 작품에 한해 수동으로 확인하고 요약한 한국어 메타데이터

API 응답과 데이터 범위는 각 제공처의 갱신 시점, 요청 제한, 서비스 상태에 영향을 받습니다. 일부 정보는 늦게 표시되거나 제공되지 않을 수 있습니다.

## API 약관 유의 사항

AniList는 API 이용 약관에서 경쟁 관계에 있는 비보완형 애니메이션/만화 목록·트래커 서비스에 대한 API 사용을 제한한다고 명시합니다. 개인 프로젝트를 공개 다중 사용자 서비스로 확장하거나 배포 범위를 넓히기 전에 현재 약관과 허가 필요 여부를 확인해야 합니다: https://docs.anilist.co/guide/terms-of-use/

## PWA와 모바일

Android Chrome 및 iPhone Safari에서 HTTPS 웹 주소로 접속해 일반 웹사이트로 이용할 수 있습니다. 원한다면 Android의 앱 설치/홈 화면 추가 또는 iPhone Safari의 공유 → 홈 화면에 추가 기능을 사용할 수 있습니다. 별도 APK는 포함하지 않습니다.

서비스 워커는 앱 셸과 일부 정적 파일을 캐시합니다. 모든 애니메이션 정보가 오프라인에서 동작하는 것은 아니며, 외부 API 조회에는 인터넷 연결이 필요합니다.

## 폴더 구조

```text
ANIME-HUB-Web/
├── index.html
├── styles.css
├── app.js
├── sw.js
├── manifest.webmanifest
├── _headers
├── package.json
├── VERSION.txt
├── DEPLOY_NO_INSTALL_KO.md
├── START_HERE_KO.md
├── START_HERE_NO_INSTALL_KO.md
├── CHANGELOG_KO.md
├── TEST_REPORT_KO.md
├── KOREAN_DATA_POLICY_KO.md
├── ROADMAP_KO.md
├── DECISION_G0_KO.md
├── assets/
├── data/
│   ├── korean-catalog.json
│   ├── korean-catalog.js
│   ├── korean-match.js
│   └── api-vars.js
├── tools/
│   ├── build_korean_catalog.py
│   ├── check_korean_catalog.py
│   ├── check_backup.py
│   └── schedule_probe.py
├── tests/
│   ├── korean-id-cases.json
│   ├── korean-catalog.test.mjs
│   ├── api-vars.test.mjs
│   ├── id-match.test.html
│   ├── e2e/
│   └── fixtures/
└── supabase/
    ├── schema.sql
    └── tests/
        ├── rls_access_test.sql
        └── README_KO.md
```
