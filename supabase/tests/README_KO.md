# Supabase RLS 교차 접근 테스트

`rls_access_test.sql`은 **테스트 계정 2개**로 다음을 확인합니다.

| 항목 | 기대 결과 |
|---|---|
| A가 자기 보관함 행 생성·조회·수정 | 성공 |
| B가 A의 행 조회 | 0 rows |
| B가 A의 행 수정·삭제 | 0 rows |
| B가 A 소유로 insert | `insufficient_privilege` (42501) |
| B가 A의 프로필(collections) 조회·수정 | 0 rows |
| B가 A 소유 프로필 insert | `insufficient_privilege` (42501) |
| 테스트 종료 후 원본 행 | 2건 유지 |

## 실행 방법

1. 앱에서 테스트 계정 2개를 만듭니다. (이메일 인증 필요)
2. Supabase 대시보드 → Authentication → Users에서 두 계정의 UUID를 복사합니다.
3. `supabase/tests/rls_access_test.sql`의 아래 두 값을 실제 UUID로 바꿉니다.

   ```text
   11111111-1111-4111-8111-111111111111  → 계정 A
   22222222-2222-4222-8222-222222222222  → 계정 B
   ```

4. Supabase 대시보드 → SQL Editor에서 파일 **전체**를 한 번에 실행합니다.
5. 마지막 `SELECT` 결과에서 모든 `outcome`이 `PASS`인지 확인합니다.

```text
step                        | outcome | detail
----------------------------+---------+--------
A1 자기 행 생성              | PASS    |
A2 자기 행 조회              | PASS    | rows=1
...
Z1 원본 행 보존              | PASS    | rows=2
```

스크립트는 마지막에 `ROLLBACK`하므로 테스트 데이터가 남지 않습니다.

## 실패했을 때

- **B1/B6이 FAIL**: `select` 정책의 `using` 절이 `auth.uid()` 대신 다른 값을 보고 있습니다.
- **B4/B8이 FAIL**: `with check`가 없거나 `user_id`를 신뢰하고 있습니다.
- **A1/A4가 FAIL**: `grant` 또는 정책이 자기 행 insert를 막고 있습니다.
- **Z1이 FAIL**: 앞선 단계에서 예상치 못하게 데이터가 삭제되었습니다.

## CI 연결 (v4.8)

현재는 수동 실행입니다. 자동화하려면 다음 중 하나가 필요합니다.

- Supabase Branching + `pgTAP` 확장
- 테스트 전용 프로젝트에서 `psql`로 스크립트 실행 후 종료 코드 확인
- `supabase test db` (Supabase CLI)

자동화 전까지는 **v4.8 릴리스마다 이 스크립트를 수동 실행**하고 결과를 `TEST_REPORT_KO.md`에 기록합니다.
