# ANIME HUB 남은 작업 가이드

이 문서는 v4.6.0 기준으로 **아직 완료되지 않은 작업**을 실제로 수행하기 위한 단계별 가이드입니다.
각 항목은 독립적으로 진행할 수 있으며, 순서대로 따라가면 됩니다.

---

## 0. 사전 준비

### 0.1 필요한 도구 설치

| 도구 | 용도 | 설치 방법 |
|---|---|---|
| Node.js 20+ | `npm test`, `node --check` | https://nodejs.org → LTS 다운로드 → 설치 |
| Git | 버전 관리 (이미 설치됨) | winget으로 설치 완료 |
| Python 3.10+ | 데이터 검사, 스냅샷 수집 | 이미 설치됨 (`py --version`) |
| Supabase 계정 | RLS 테스트, 동기화 | https://supabase.com → 무료 프로젝트 생성 |
| TMDB 계정 (선택) | 한국어 메타데이터 | https://www.themoviedb.org → API 키 발급 |

### 0.2 환경 변수 확인

```powershell
# PowerShell에서 확인
node --version
npm --version
py --version
git --version
```

모두 버전이 출력되면 준비 완료입니다.

---

## 1. Node.js 테스트 실행 (CI 환경에서)

### 1.1 로컬에서 실행

```powershell
cd "E:\다운로드\anime-hub"
npm install          # devDependencies 없음, node_modules 생성 안 됨
npm run check        # 문법 검사: node --check app.js/sw.js/data/*.js
npm test             # 단위 테스트: node --test tests/
npm run verify       # check + test 모두
```

### 1.2 예상 결과

```
✔ 카탈로그: 메타 정보
✔ 카탈로그: 레코드 필수 필드·값
✔ 카탈로그: workId·AniList ID·MAL ID 유일성
✔ 매칭: AniList ID 직접 매칭
... (32개 ID 매칭 테스트)
✔ 방영: merge: 빈 배열
... (11개 방영 모듈 테스트)
✔ 상태: 취소
... (9개 상태 판정 테스트)
✔ 동기화: enqueue/dequeue round trip
... (6+7개 동기화 테스트)
✔ 추천: computeCandidateScore: 선호 장르 작품은 높은 점수
... (6+9개 추천 테스트)
```

모든 테스트가 통과해야 합니다. 실패 시 `TEST_REPORT_KO.md`에 기록하세요.

### 1.3 GitHub Actions CI

`.github/workflows/ci.yml`이 이미 설정되어 있습니다. GitHub 저장소에 push하면 자동 실행됩니다.

```powershell
# GitHub 저장소 생성 후
git remote add origin https://github.com/<username>/anime-hub.git
git push -u origin master
```

CI에서 확인할 것:
- `static` job: 카탈로그 검사, 백업 검사, 문법 검사, 단위 테스트, JWT 흔적 검사
- `browser` job: Playwright 스모크 테스트 (continue-on-error: true → 안정화 후 필수로 승격)

---

## 2. v4.8 RLS 교차 접근 테스트 (수동 실행)

### 2.1 Supabase 프로젝트 준비

1. https://supabase.com → "New Project" 클릭
2. 프로젝트 이름: `anime-hub-test` (또는 원하는 이름)
3. 비밀번호 설정 (기억해두세요)
4. 리전: 가까운 리전 선택 (예: Northeast Asia - Tokyo)
5. 프로젝트 생성 대기 (1-2분)

### 2.2 스키마 적용

1. Supabase 대시보드 → SQL Editor
2. `supabase/schema.sql` 전체 내용 복사 → 붙여넣기 → "Run"
3. `supabase/migrations/0001_sync_hardening.sql` 내용 복사 → 붙여넣기 → "Run"

### 2.3 테스트 계정 2개 생성

**방법 A: 앱에서 회원가입**
1. 앱 설정 → Supabase URL과 anon key 입력
2. 계정 만들기 → 이메일 2개로 가입
3. 이메일 인증 완료

**방법 B: Supabase 대시보드**
1. Authentication → Users → "Add user" → 이메일/비밀번호 입력 (2개)

### 2.4 UUID 확인

1. Supabase 대시보드 → Authentication → Users
2. 각 계정의 UUID 복사 (예: `a1b2c3d4-...`)

### 2.5 RLS 테스트 실행

1. `supabase/tests/rls_access_test.sql` 파일 열기
2. 상단의 두 UUID를 실제 값으로 교체:
   ```sql
   -- A: 11111111-1111-4111-8111-111111111111  → 실제 계정 A UUID
   -- B: 22222222-2222-4222-8222-222222222222  → 실제 계정 B UUID
   ```
3. Supabase SQL Editor에서 **전체 파일** 실행
4. 마지막 `SELECT` 결과 확인:

```
step                        | outcome | detail
----------------------------+---------+--------
A1 자기 행 생성              | PASS    |
A2 자기 행 조회              | PASS    | rows=1
A3 자기 행 수정              | PASS    | rows=1
A4 자기 프로필 생성          | PASS    |
B1 A 행 조회 차단            | PASS    | rows=0
B2 A 행 수정 차단            | PASS    | rows=0
B3 A 행 삭제 차단            | PASS    | rows=0
B4 A 소유 행 삽입 차단       | PASS    | 42501
B5 자기 행 생성              | PASS    |
B6 A 프로필 조회 차단        | PASS    | rows=0
B7 A 프로필 수정 차단        | PASS    | rows=0
B8 A 프로필 삽입 차단        | PASS    | 42501
Z1 원본 행 보존              | PASS    | rows=2
```

모든 outcome이 `PASS`여야 합니다. `FAIL`이 있으면 `supabase/tests/README_KO.md`의 실패 진단표를 참고하세요.

### 2.6 결과 기록

`TEST_REPORT_KO.md`에 아래 항목 추가:
```
### RLS 교차 접근 테스트 (수동)
- 실행일: YYYY-MM-DD
- 계정 A: <UUID>
- 계정 B: <UUID>
- 결과: 14/14 PASS
- 실패 항목: (없음 또는 목록)
```

---

## 3. v4.8 오프라인 큐 E2E 리허설

### 3.1 준비

1. Supabase 프로젝트 연결 (2.1~2.2 완료)
2. 앱에서 계정 A로 로그인
3. 보관함에 작품 2-3개 추가

### 3.2 오프라인 시나리오

**시나리오 1: 오프라인에서 추가 → 온라인 복귀**
1. 브라우저 DevTools → Network → "Offline" 체크
2. 보관함에 새 작품 추가 (상태 변경)
3. "오프라인 변경 사항" 토스트 확인
4. DevTools → Network → "Offline" 해제
5. "오프라인 변경 사항을 동기화했습니다." 토스트 확인
6. Supabase 대시보드에서 데이터 확인

**시나리오 2: 오프라인에서 삭제 → 온라인 복귀**
1. 오프라인 상태에서 보관함 항목 삭제
2. 온라인 복귀
3. 삭제된 항목이 클라우드에서 제거되었는지 확인 (tombstone)

**시나리오 3: 2기기 동시 편집**
1. 기기 1 (PC)에서 작품 A 상태 변경 → "시청 중"
2. 기기 2 (모바일)에서 같은 작품 A 상태 변경 → "완료"
3. 기기 1에서 새로고침 → 충돌 모달 표시 확인
4. "클라우드 값 사용" 선택 → 기기 2의 값으로 통일

### 3.3 검증 포인트

- [ ] 오프라인 변경이 큐에 쌓임 (`localStorage.animehub_sync_queue_v1`)
- [ ] 온라인 복귀 시 큐가 비워짐
- [ ] 5회 실패 시 큐에서 제거 (mutation dropped)
- [ ] 충돌 모달이 양쪽 변경 시 표시됨
- [ ] tombstone으로 삭제된 항목이 다른 기기에서 부활하지 않음

---

## 4. v4.7 지연·결방 감지 고도화

### 4.1 1주일 데이터 수집

```powershell
# 매일 1회 실행 (7일간)
cd "E:\다운로드\anime-hub"
py tools\schedule_probe.py --days 7
```

또는 Windows 작업 스케줄러로 자동화:
1. `taskschd.msc` → "작업 만들기"
2. 트리거: 매일 오전 9시
3. 동작: `py "E:\다운로드\anime-hub\tools\schedule_probe.py" --days 7`
4. 7일 후 `data/schedule-snapshots/` 폴더에 7개 스냅샷 확인

### 4.2 데이터 분석

수집된 스냅샷을 비교하여:
- **지연 사례**: 같은 작품의 `airingAt`이 스냅샷 간에 6시간 이상 늦어진 경우
- **결방 사례**: `status`가 `HIATUS` 또는 `CANCELLED`로 변경된 경우
- **미방영 사례**: `airingAt`이 24시간 이상 지났는데 같은 회차가 그대로인 경우

Python으로 분석:
```python
import json, glob
snapshots = sorted(glob.glob("data/schedule-snapshots/schedule-*.json"))
for i in range(1, len(snapshots)):
    prev = json.load(open(snapshots[i-1]))
    curr = json.load(open(snapshots[i]))
    # 비교 로직
```

### 4.3 발견된 패턴을 코드에 반영

- `classifyAiring`의 임계값 조정 (6시간 → 실제 사례에 맞게)
- 새로운 상태 추가 (예: `POSTPONED`, `RESCHEDULED`)
- UI 라벨 개선

---

## 5. G0 결정 문서 완성

### 5.1 `DECISION_G0_KO.md` 서명

1. 문서를 열고 D1~D10 결정 표 작성
2. D1 (서비스 범위) 결정:
   - **A (개인·비공개 베타)**: 지금 시작 가능, 법적 리스크 낮음
   - **B (공개 다중 사용자)**: 4장 체크리스트 100% 완료 후
3. 대표 서명란 작성
4. 4장 체크리스트 항목별 확인

### 5.2 AniList 약관 확인

1. https://docs.anilist.co/guide/terms-of-use/ 방문
2. "경쟁 관계의 비보완형 애니메이션/만화 목록·트래커 서비스" 조항 확인
3. 필요 시 AniList에 이메일로 허가 문의:
   ```
   To: anilist@anilist.co (또는 공식 연락처)
   Subject: API Usage Inquiry for Personal Anime Tracker Project
   Body: 프로젝트 설명, 사용 범위, 비상업적 여부, 예상 사용자 수
   ```
4. 응답을 `DECISION_G0_KO.md` 3.1절에 기록

### 5.3 개인정보 처리방침 초안

공개 서비스(B) 전환 시 필요한 페이지:
- 이용약관 (`/terms`)
- 개인정보 처리방침 (`/privacy`)
- 삭제 요청 창구 (이메일 또는 폼)

---

## 6. 체크리스트 (릴리스 전)

### v4.6.0 릴리스
- [x] 카탈로그 데이터 분리
- [x] ID 매칭 테스트 32건 통과
- [x] AniList 400 버그 수정
- [x] 백업/복원 E2E 통과
- [x] 방영 일정 캐시 + mine-only 토글
- [x] 시간대 선택기
- [x] 사용자 입력 한국어 자료
- [x] CI 스켈레톤
- [x] 단일 파일 빌드
- [ ] `npm test` CI에서 실행 확인
- [ ] `node --check` CI에서 실행 확인

### v4.7 릴리스
- [ ] 지연/결방 실제 사례 수집 (1주)
- [ ] Web Push 서버 스케줄러
- [ ] 알림 정확도 측정

### v4.8 릴리스
- [ ] RLS 테스트 수동 실행 (14/14 PASS)
- [ ] 오프라인 큐 E2E 리허설
- [ ] 충돌 UI 다중 기기 검증
- [ ] 계정 삭제 기능

### v4.9 릴리스
- [ ] 추천 평가 지표 런타임 모니터링
- [ ] 콜드스타트 개선
- [ ] 명시적 피드백 (관심 없음)

### v5.0 릴리스
- [ ] UGC 검수 흐름
- [ ] 관리자 역할·감사 로그
- [ ] 신고·차단

### v5.1 릴리스
- [ ] Web Push
- [ ] 오프라인 쓰기
- [ ] iOS 저장소 정리

### v5.2 릴리스
- [ ] 최종 보안 감사
- [ ] 성능 벤치마크
- [ ] 접근성 검증

---

## 7. 문제 발생 시

### 앱이 로드되지 않음
- 브라우저 콘솔 확인 (F12 → Console)
- `anime-hub-single.html`은 단일 파일이므로 네트워크 문제는 API 호출만 영향
- AniList API가 차단되면 방영 일정·검색이 실패 → VPN 또는 다른 네트워크 시도

### 한국어 제목이 안 보임
- TMDB 토큰이 없으면 AniList/Jikan 별칭만 사용
- "한국어 제목 직접 입력" 버튼으로 수동 입력 가능
- `data/korean-catalog.json`에 레코드 추가 후 `py tools/build_korean_catalog.py` 실행

### 동기화 실패
- Supabase schema.sql이 최신인지 확인
- `anime_lists` 테이블에 `deleted_at`, `revision`, `client_id` 컬럼이 있는지 확인
- RLS 정책이 적용되었는지 확인 (2.5 참고)

### 테스트 실패
- `tools/check_korean_catalog.py` 실패 → JSON 스키마 또는 생성 파일 동기화 확인
- 브라우저 하네스 실패 → 해당 모듈의 import 경로 확인
- CI 실패 → GitHub Actions 로그 확인

---

## 8. 연락처·참고

- **AniList API 문서**: https://docs.anilist.co/
- **TMDB API 문서**: https://developer.themoviedb.org/
- **Jikan API 문서**: https://docs.api.jikan.moe/
- **Supabase 문서**: https://supabase.com/docs
- **PWA 가이드**: https://web.dev/progressive-web-apps/

---

*이 가이드는 v4.6.0 기준으로 작성되었습니다. 각 버전 릴리스 시 업데이트하세요.*
