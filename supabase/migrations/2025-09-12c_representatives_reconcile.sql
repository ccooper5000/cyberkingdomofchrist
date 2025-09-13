-- Reconcile representatives + create supporting tables if missing (idempotent)

-- 1) Bring public.representatives to the expected shape
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='representatives' and column_name='office'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='representatives' and column_name='office_name'
  ) then
    alter table public.representatives rename column "office" to office_name;
  end if;
end$$;

alter table public.representatives
  add column if not exists civic_person_id    text,
  add column if not exists civic_office_id    text,
  add column if not exists name               text,
  add column if not exists party              text,
  add column if not exists photo_url          text,
  add column if not exists office_name        text,
  add column if not exists level              text,
  add column if not exists chamber            text,
  add column if not exists state              text,   -- 2-letter USPS
  add column if not exists district           text,
  add column if not exists contact_email      text,
  add column if not exists contact_form_url   text,
  add column if not exists phone              text,
  add column if not exists website            text,
  add column if not exists twitter            text,
  add column if not exists facebook           text,
  add column if not exists term_end           date,
  add column if not exists last_synced        timestamptz default now(),
  add column if not exists active             boolean default true;

update public.representatives
set active = true
where active is null;

-- Optional default/constraint
alter table public.representatives
  alter column level set default 'federal';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'representatives_level_chk'
      and conrelid = 'public.representatives'::regclass
  ) then
    alter table public.representatives
      add constraint representatives_level_chk
      check (level is null or level in ('federal','state','local'));
  end if;
end$$;

-- Indexes
create unique index if not exists representatives_civic_person_id_key
  on public.representatives(civic_person_id);

create index if not exists idx_representatives_state_district
  on public.representatives(state, district, chamber);

create index if not exists idx_representatives_office_name
  on public.representatives((lower(office_name)));

-- RLS + read policy
alter table public.representatives enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='representatives' and policyname='reps read'
  ) then
    create policy "reps read" on public.representatives for select using (true);
  end if;
end$$;

-- 2) Supporting tables (create only if missing)
create table if not exists public.representative_divisions (
  rep_id uuid not null references public.representatives(id) on delete cascade,
  ocd_division_id text not null,
  primary key (rep_id, ocd_division_id)
);
create index if not exists idx_rep_divisions_ocd on public.representative_divisions(ocd_division_id);
alter table public.representative_divisions enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='representative_divisions' and policyname='rep-div read'
  ) then
    create policy "rep-div read" on public.representative_divisions for select using (true);
  end if;
end$$;

create table if not exists public.civic_zip_divisions_cache (
  zip5 text primary key,
  ocd_division_ids text[] not null,
  updated_at timestamptz not null default now()
);
alter table public.civic_zip_divisions_cache enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='civic_zip_divisions_cache' and policyname='zip-cache read'
  ) then
    create policy "zip-cache read" on public.civic_zip_divisions_cache for select using (true);
  end if;
end$$;

create table if not exists public.user_representatives_cache (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  rep_ids uuid[] not null,
  zipcode text,
  computed_at timestamptz not null default now()
);
alter table public.user_representatives_cache enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='user_representatives_cache' and policyname='user-reps-cache read own'
  ) then
    create policy "user-reps-cache read own"
      on public.user_representatives_cache for select using (auth.uid() = user_id);
  end if;
end$$;
