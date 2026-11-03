-- ANIME HUB v4.8 동기화 하드닝 마이그레이션
-- supabase/schema.sql 위에 적용합니다. (Supabase SQL Editor에서 실행)
--
-- 추가:
--   - anime_lists.deleted_at (tombstone)
--   - anime_lists.revision (낙관적 동시성)
--   - anime_lists.client_id (변경 출처 기기)
--   - anime_sync_mutations (idempotency)
--   - updated_at 자동 갱신 트리거

alter table public.anime_lists
  add column if not exists deleted_at timestamptz,
  add column if not exists revision bigint not null default 1,
  add column if not exists client_id text;

-- updated_at 자동 갱신
create or replace function public.anime_lists_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if (tg_op = 'UPDATE') then
    new.revision = coalesce(old.revision, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists anime_lists_touch_updated_at on public.anime_lists;
create trigger anime_lists_touch_updated_at
  before insert or update on public.anime_lists
  for each row execute function public.anime_lists_touch_updated_at();

-- 삭제는 deleted_at으로 표현 (hard delete 대신)
create index if not exists anime_lists_user_deleted_idx
  on public.anime_lists (user_id, deleted_at);

-- idempotency 테이블
create table if not exists public.anime_sync_mutations (
  mutation_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('upsert', 'delete', 'profile')),
  applied_at timestamptz not null default now(),
  payload jsonb
);

alter table public.anime_sync_mutations enable row level security;
revoke all on table public.anime_sync_mutations from anon, authenticated;
grant select, insert on table public.anime_sync_mutations to authenticated;

drop policy if exists "Users manage own mutations" on public.anime_sync_mutations;
create policy "Users manage own mutations"
  on public.anime_sync_mutations for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 클라이언트는 deleted_at이 null인 행만 기본 조회 (RLS 보조)
-- (앱에서 .is('deleted_at', null) 필터를 사용합니다)
