-- =========
-- EXTENSIONS
-- =========
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- =========
-- ENUMS
-- =========
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prayer_category') then
    create type prayer_category as enum ('trump_politics','health','family','business','national','custom');
  end if;
  if not exists (select 1 from pg_type where typname = 'subscription_tier') then
    create type subscription_tier as enum ('free','faith_warrior','kingdom_builder');
  end if;
end$$;

-- =========
-- TABLES
-- =========

-- Public profile linked to auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  line1 text,
  line2 text,
  city text,
  state text,
  postal_code text,
  country text default 'US',
  lat double precision,
  lng double precision,
  county text,
  cd text,   -- US Congressional District
  sd text,   -- State Senate
  hd text,   -- State House
  muni text, -- municipality/local district
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_user_addresses_primary on public.user_addresses (user_id) where is_primary;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tier subscription_tier not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null check (status in ('active','trialing','past_due','canceled','incomplete')),
  renewal_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_subscriptions_user on public.subscriptions(user_id);

create table if not exists public.prayers (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  category prayer_category not null,
  content text not null check (length(content) <= 2000),
  visibility text not null default 'public' check (visibility in ('public','group','circle')),
  group_id uuid,
  circle_id uuid,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_prayers_author on public.prayers(author_id);
create index if not exists idx_prayers_created_at on public.prayers(created_at desc);
create index if not exists idx_prayers_category on public.prayers(category);
create index if not exists idx_prayers_featured on public.prayers(is_featured) where is_featured = true;

create table if not exists public.prayer_likes (
  prayer_id uuid not null references public.prayers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (prayer_id, user_id)
);

create table if not exists public.prayer_comments (
  id uuid primary key default gen_random_uuid(),
  prayer_id uuid not null references public.prayers(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(content) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists idx_prayer_comments_prayer on public.prayer_comments(prayer_id);
create index if not exists idx_prayer_comments_author on public.prayer_comments(author_id);

create table if not exists public.prayer_shares (
  id uuid primary key default gen_random_uuid(),
  prayer_id uuid not null references public.prayers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('facebook','x','instagram','tiktok','whatsapp','telegram','other')),
  share_ref text,
  created_at timestamptz not null default now()
);
create index if not exists idx_prayer_shares_user on public.prayer_shares(user_id);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin','owner')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.prayer_circles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  is_private boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.circle_members (
  circle_id uuid not null references public.prayer_circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin','owner')),
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table if not exists public.representatives (
  id uuid primary key default gen_random_uuid(),
  source text not null,                     -- e.g., google_civic, openstates
  division_id text not null,                -- OCD division id
  office text not null,                     -- US House, Governor, State Senator, Mayor, etc.
  name text not null,
  party text,
  email text[],
  phone text[],
  twitter text,
  facebook text,
  instagram text,
  website text,
  state text,
  district text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_reps_division on public.representatives(division_id);
create index if not exists idx_reps_office on public.representatives(office);
create index if not exists idx_reps_state on public.representatives(state);

create table if not exists public.user_representatives (
  user_id uuid not null references public.profiles(id) on delete cascade,
  rep_id uuid not null references public.representatives(id) on delete cascade,
  level text not null check (level in ('local','state','federal')),
  created_at timestamptz not null default now(),
  primary key (user_id, rep_id)
);

create table if not exists public.outreach_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  prayer_id uuid not null references public.prayers(id) on delete cascade,
  target_rep_id uuid not null references public.representatives(id) on delete set null,
  channels text[] not null,  -- subset of {'email','x','facebook'}
  status text not null default 'queued' check (status in ('queued','sent','failed','throttled')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_outreach_user on public.outreach_requests(user_id);
create index if not exists idx_outreach_status on public.outreach_requests(status);

create table if not exists public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('prayer','comment','profile')),
  entity_id uuid not null,
  flagged_by uuid, -- nullable if AI
  reason text not null,
  ai_score numeric,
  status text not null default 'open' check (status in ('open','reviewing','resolved','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.privacy_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy_version text not null,
  consented_at timestamptz not null default now(),
  email_opt_in boolean not null default false
);
create index if not exists idx_privacy_consents_user on public.privacy_consents(user_id);

create table if not exists public.stripe_events (
  id text primary key,      -- stripe event id
  type text not null,
  data jsonb not null,
  received_at timestamptz not null default now()
);

-- =========
-- RLS (Row Level Security)
-- =========

alter table public.profiles enable row level security;
alter table public.user_addresses enable row level security;
alter table public.subscriptions enable row level security;
alter table public.prayers enable row level security;
alter table public.prayer_likes enable row level security;
alter table public.prayer_comments enable row level security;
alter table public.prayer_shares enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.prayer_circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.representatives enable row level security;
alter table public.user_representatives enable row level security;
alter table public.outreach_requests enable row level security;
alter table public.moderation_flags enable row level security;
alter table public.audit_logs enable row level security;
alter table public.privacy_consents enable row level security;
alter table public.stripe_events enable row level security;

-- ============================
-- FIXED RLS POLICIES (ORDERING)
-- ============================

-- profiles
drop policy if exists "profiles_read_public" on public.profiles;
create policy "profiles_read_public"
on public.profiles
for select
to authenticated, anon
using (true);

drop policy if exists "profiles_self_write" on public.profiles;
create policy "profiles_self_write"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- user_addresses
drop policy if exists "user_addresses_self_crud" on public.user_addresses;
create policy "user_addresses_self_crud"
on public.user_addresses
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- subscriptions (read own; writes via service role)
drop policy if exists "subscriptions_read_own" on public.subscriptions;
create policy "subscriptions_read_own"
on public.subscriptions
for select
to authenticated
using (auth.uid() = user_id);

-- prayers
drop policy if exists "prayers_read_public_or_member" on public.prayers;
create policy "prayers_read_public_or_member"
on public.prayers
for select
to authenticated, anon
using (visibility = 'public');

drop policy if exists "prayers_self_insert" on public.prayers;
create policy "prayers_self_insert"
on public.prayers
for insert
to authenticated
with check (auth.uid() = author_id);

drop policy if exists "prayers_self_update_delete" on public.prayers;
create policy "prayers_self_update_delete"
on public.prayers
for update, delete
to authenticated
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

-- prayer_likes
drop policy if exists "likes_self_crud" on public.prayer_likes;
create policy "likes_self_crud"
on public.prayer_likes
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- prayer_comments
drop policy if exists "comments_read_public" on public.prayer_comments;
create policy "comments_read_public"
on public.prayer_comments
for select
to authenticated, anon
using (true);

drop policy if exists "comments_self_write" on public.prayer_comments;
create policy "comments_self_write"
on public.prayer_comments
for insert, update, delete
to authenticated
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

-- prayer_shares
drop policy if exists "shares_self_crud" on public.prayer_shares;
create policy "shares_self_crud"
on public.prayer_shares
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- groups
drop policy if exists "groups_read_public" on public.groups;
create policy "groups_read_public"
on public.groups
for select
to authenticated, anon
using (true);

drop policy if exists "groups_owner_write" on public.groups;
create policy "groups_owner_write"
on public.groups
for insert, update, delete
to authenticated
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

-- group_members
drop policy if exists "group_members_self_manage" on public.group_members;
create policy "group_members_self_manage"
on public.group_members
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- prayer_circles
drop policy if exists "circles_owner_manage" on public.prayer_circles;
create policy "circles_owner_manage"
on public.prayer_circles
for all
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- circle_members
drop policy if exists "circle_members_self_manage" on public.circle_members;
create policy "circle_members_self_manage"
on public.circle_members
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- representatives (read-only public; writes by service/edge funcs)
drop policy if exists "representatives_read_all" on public.representatives;
create policy "representatives_read_all"
on public.representatives
for select
to authenticated, anon
using (true);

-- user_representatives
drop policy if exists "user_reps_self_crud" on public.user_representatives;
create policy "user_reps_self_crud"
on public.user_representatives
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- outreach_requests
drop policy if exists "outreach_self_read_insert" on public.outreach_requests;
create policy "outreach_self_read_insert"
on public.outreach_requests
for select, insert
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- moderation_flags (admin-only; keep locked down)
drop policy if exists "modflags_admin_only" on public.moderation_flags;
create policy "modflags_admin_only"
on public.moderation_flags
for all
to authenticated
using (false)
with check (false);

-- audit_logs (admin-only)
drop policy if exists "auditlogs_admin_only" on public.audit_logs;
create policy "auditlogs_admin_only"
on public.audit_logs
for all
to authenticated
using (false)
with check (false);

-- privacy_consents (self)
drop policy if exists "privacy_consents_self" on public.privacy_consents;
create policy "privacy_consents_self"
on public.privacy_consents
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- stripe_events (service/webhook only; effectively no public access)
drop policy if exists "stripe_events_no_public" on public.stripe_events;
create policy "stripe_events_no_public"
on public.stripe_events
for select
to authenticated
using (false);

-- =========
-- TRIGGERS (updated_at)
-- =========
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_prayers_updated_at on public.prayers;
create trigger trg_prayers_updated_at
before update on public.prayers
for each row execute function public.set_updated_at();