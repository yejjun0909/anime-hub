-- ANIME HUB RLS 교차 접근 테스트 (2개 계정)
--
-- 목적: 한 사용자가 다른 사용자의 보관함·컬렉션·검색 데이터를
--       읽기/수정/삭제/삽입할 수 없는지 실제 RLS로 확인합니다.
--
-- 준비:
--   1. Supabase Auth에서 테스트 계정 2개를 만듭니다(앱 회원가입 또는 대시보드).
--   2. 아래 두 UUID를 실제 계정 UUID로 바꿉니다.
--   3. supabase/schema.sql 이 적용된 프로젝트의 SQL Editor에서
--      이 파일 전체를 한 번에 실행합니다.
--   4. 마지막 SELECT 결과의 outcome이 모두 PASS여야 합니다.
--      스크립트는 ROLLBACK 하므로 테스트 데이터가 남지 않습니다.
--
-- 주의: service_role 키가 아니라 Supabase SQL Editor(postgres 역할)에서 실행하세요.

begin;

-- ▼▼▼ 실제 테스트 계정 UUID로 교체 ▼▼▼
-- A: 11111111-1111-4111-8111-111111111111
-- B: 22222222-2222-4222-8222-222222222222
-- ▲▲▲ 실제 테스트 계정 UUID로 교체 ▲▲▲

do $$
begin
  if not exists (select 1 from auth.users where id = '11111111-1111-4111-8111-111111111111') then
    raise exception '테스트 계정 A(11111111-...)가 auth.users에 없습니다. UUID를 실제 계정으로 바꾸세요.';
  end if;
  if not exists (select 1 from auth.users where id = '22222222-2222-4222-8222-222222222222') then
    raise exception '테스트 계정 B(22222222-...)가 auth.users에 없습니다. UUID를 실제 계정으로 바꾸세요.';
  end if;
end $$;

-- 이전 실행의 잔여 테스트 데이터 정리 (postgres 역할, RLS 우회)
delete from public.anime_lists where note like 'rls-selftest%';
delete from public.anime_user_data where collections::text like '%rls-selftest%';

create temp table _rls_results (
  step text,
  outcome text,
  detail text
) on commit drop;
grant select, insert on _rls_results to authenticated;

-- ============================================================
-- 사용자 A 세션
-- ============================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
set local role authenticated;

-- A1. 자기 보관함 행 생성
do $$
begin
  insert into public.anime_lists (user_id, media_id, status, score, note)
  values ('11111111-1111-4111-8111-111111111111', 990001, 'CURRENT', 80, 'rls-selftest A')
  on conflict (user_id, media_id) do update set score = excluded.score;
  insert into _rls_results values ('A1 자기 행 생성', 'PASS', '');
exception when others then
  insert into _rls_results values ('A1 자기 행 생성', 'FAIL', SQLERRM);
end $$;

-- A2. 자기 행만 보임
do $$
declare visible int;
begin
  select count(*) into visible from public.anime_lists where media_id = 990001;
  insert into _rls_results values ('A2 자기 행 조회', case when visible = 1 then 'PASS' else 'FAIL' end, 'rows=' || visible);
end $$;

-- A3. 자기 행 수정
do $$
declare changed int;
begin
  with updated as (
    update public.anime_lists set score = 85
    where media_id = 990001
    returning 1
  )
  select count(*) into changed from updated;
  insert into _rls_results values ('A3 자기 행 수정', case when changed = 1 then 'PASS' else 'FAIL' end, 'rows=' || changed);
end $$;

-- A4. 자기 프로필 생성
do $$
begin
  insert into public.anime_user_data (user_id, collections, saved_searches)
  values ('11111111-1111-4111-8111-111111111111', '[{"id":"rls-selftest","name":"A"}]'::jsonb, '[]'::jsonb)
  on conflict (user_id) do update set collections = excluded.collections;
  insert into _rls_results values ('A4 자기 프로필 생성', 'PASS', '');
exception when others then
  insert into _rls_results values ('A4 자기 프로필 생성', 'FAIL', SQLERRM);
end $$;

-- ============================================================
-- 사용자 B 세션 (같은 role, 다른 JWT)
-- ============================================================
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

-- B1. A의 행이 보이지 않음
do $$
declare visible int;
begin
  select count(*) into visible from public.anime_lists where user_id = '11111111-1111-4111-8111-111111111111';
  insert into _rls_results values ('B1 A 행 조회 차단', case when visible = 0 then 'PASS' else 'FAIL' end, 'rows=' || visible);
end $$;

-- B2. A의 행 수정 불가 (0 rows)
do $$
declare changed int;
begin
  with updated as (
    update public.anime_lists set score = 0
    where user_id = '11111111-1111-4111-8111-111111111111'
    returning 1
  )
  select count(*) into changed from updated;
  insert into _rls_results values ('B2 A 행 수정 차단', case when changed = 0 then 'PASS' else 'FAIL' end, 'rows=' || changed);
end $$;

-- B3. A의 행 삭제 불가 (0 rows)
do $$
declare removed int;
begin
  with deleted as (
    delete from public.anime_lists
    where user_id = '11111111-1111-4111-8111-111111111111'
    returning 1
  )
  select count(*) into removed from deleted;
  insert into _rls_results values ('B3 A 행 삭제 차단', case when removed = 0 then 'PASS' else 'FAIL' end, 'rows=' || removed);
end $$;

-- B4. A 소유로 insert 시도 → 42501 이어야 함
do $$
begin
  begin
    insert into public.anime_lists (user_id, media_id, status, note)
    values ('11111111-1111-4111-8111-111111111111', 990003, 'PLANNING', 'rls-selftest B-forged');
    insert into _rls_results values ('B4 A 소유 행 삽입 차단', 'FAIL', '삽입이 허용됨');
  exception when insufficient_privilege then
    insert into _rls_results values ('B4 A 소유 행 삽입 차단', 'PASS', '42501');
  end;
end $$;

-- B5. 자기 행 생성은 가능
do $$
begin
  insert into public.anime_lists (user_id, media_id, status, note)
  values ('22222222-2222-4222-8222-222222222222', 990002, 'COMPLETED', 'rls-selftest B')
  on conflict (user_id, media_id) do update set status = excluded.status;
  insert into _rls_results values ('B5 자기 행 생성', 'PASS', '');
exception when others then
  insert into _rls_results values ('B5 자기 행 생성', 'FAIL', SQLERRM);
end $$;

-- B6. A의 프로필 조회 차단
do $$
declare visible int;
begin
  select count(*) into visible from public.anime_user_data
  where user_id = '11111111-1111-4111-8111-111111111111';
  insert into _rls_results values ('B6 A 프로필 조회 차단', case when visible = 0 then 'PASS' else 'FAIL' end, 'rows=' || visible);
end $$;

-- B7. A의 프로필 수정 차단
do $$
declare changed int;
begin
  with updated as (
    update public.anime_user_data set collections = '[]'::jsonb
    where user_id = '11111111-1111-4111-8111-111111111111'
    returning 1
  )
  select count(*) into changed from updated;
  insert into _rls_results values ('B7 A 프로필 수정 차단', case when changed = 0 then 'PASS' else 'FAIL' end, 'rows=' || changed);
end $$;

-- B8. A의 프로필 행에 insert 시도 → 42501 이어야 함
do $$
begin
  begin
    insert into public.anime_user_data (user_id, collections, saved_searches)
    values ('11111111-1111-4111-8111-111111111111', '[]'::jsonb, '[]'::jsonb)
    on conflict (user_id) do update set collections = excluded.collections;
    insert into _rls_results values ('B8 A 프로필 삽입 차단', 'FAIL', '삽입이 허용됨');
  exception when insufficient_privilege then
    insert into _rls_results values ('B8 A 프로필 삽입 차단', 'PASS', '42501');
  end;
end $$;

-- ============================================================
-- postgres 역할로 원본 확인: 두 사용자의 데이터가 각각 남아 있어야 함
-- ============================================================
reset role;

do $$
declare total int;
begin
  select count(*) into total from public.anime_lists where note like 'rls-selftest%';
  insert into _rls_results values ('Z1 원본 행 보존', case when total = 2 then 'PASS' else 'FAIL' end, 'rows=' || total);
end $$;

select step, outcome, detail from _rls_results order by step;

rollback;
