-- 2025-09-12 Canonical replies table + RLS

create extension if not exists pgcrypto;

create table if not exists public.prayer_comments (
  id uuid primary key default gen_random_uuid(),
  prayer_id uuid not null references public.prayers(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(content) <= 2000),
  created_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_prayer_comments_prayer_created
  on public.prayer_comments(prayer_id, created_at desc);
create index if not exists idx_prayer_comments_author_created
  on public.prayer_comments(author_id, created_at desc);

-- Enable RLS and add policies
alter table public.prayer_comments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='prayer_comments' and policyname='read comments (auth)'
  ) then
    create policy "read comments (auth)"
      on public.prayer_comments for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='prayer_comments' and policyname='insert own comment'
  ) then
    create policy "insert own comment"
      on public.prayer_comments for insert
      with check (auth.uid() = author_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='prayer_comments' and policyname='delete own comment'
  ) then
    create policy "delete own comment"
      on public.prayer_comments for delete
      using (auth.uid() = author_id);
  end if;
end$$;
