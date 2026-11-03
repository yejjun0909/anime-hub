-- ANIME HUB: per-user watchlist table
-- Run this once in Supabase Dashboard > SQL Editor.

create table if not exists public.anime_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id bigint not null,
  idMal bigint,
  status text not null check (status in ('PLANNING','CURRENT','COMPLETED','PAUSED','DROPPED')),
  score smallint check (score is null or (score >= 0 and score <= 100)),
  note text not null default '',
  media_snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint anime_lists_user_media_unique unique (user_id, media_id)
);

alter table public.anime_lists enable row level security;
revoke all on table public.anime_lists from anon, authenticated;

-- Allow signed-in clients to use the Data API; RLS below limits rows to each owner.
grant select, insert, update, delete on table public.anime_lists to authenticated;

drop policy if exists "Users can read their own anime list" on public.anime_lists;
create policy "Users can read their own anime list"
  on public.anime_lists for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own anime list" on public.anime_lists;
create policy "Users can insert their own anime list"
  on public.anime_lists for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own anime list" on public.anime_lists;
create policy "Users can update their own anime list"
  on public.anime_lists for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own anime list" on public.anime_lists;
create policy "Users can delete their own anime list"
  on public.anime_lists for delete to authenticated
  using (auth.uid() = user_id);

create index if not exists anime_lists_user_updated_idx
  on public.anime_lists (user_id, updated_at desc);


-- Per-account collections and saved searches. Each user owns exactly one JSON profile row.
create table if not exists public.anime_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  collections jsonb not null default '[]'::jsonb check (jsonb_typeof(collections) = 'array'),
  saved_searches jsonb not null default '[]'::jsonb check (jsonb_typeof(saved_searches) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.anime_user_data enable row level security;
revoke all on table public.anime_user_data from anon, authenticated;
grant select, insert, update, delete on table public.anime_user_data to authenticated;

drop policy if exists "Users can read their own ANIME HUB data" on public.anime_user_data;
create policy "Users can read their own ANIME HUB data"
  on public.anime_user_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own ANIME HUB data" on public.anime_user_data;
create policy "Users can insert their own ANIME HUB data"
  on public.anime_user_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own ANIME HUB data" on public.anime_user_data;
create policy "Users can update their own ANIME HUB data"
  on public.anime_user_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own ANIME HUB data" on public.anime_user_data;
create policy "Users can delete their own ANIME HUB data"
  on public.anime_user_data for delete to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists anime_user_data_updated_idx
  on public.anime_user_data (updated_at desc);
