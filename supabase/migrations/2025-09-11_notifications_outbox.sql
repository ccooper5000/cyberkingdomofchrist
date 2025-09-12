-- 2025-09-11 Notifications outbox + triggers

create extension if not exists pgcrypto;

-- Enum for event types (idempotent create)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_event_type') then
    create type notification_event_type as enum ('prayer_like','prayer_reply');
  end if;
end $$;

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type notification_event_type not null,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  prayer_id uuid not null references public.prayers(id) on delete cascade,
  comment_id uuid null references public.prayer_comments(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  status text not null default 'queued', -- queued|sent|skipped|throttled|failed
  error text null,
  created_at timestamptz not null default now(),
  processed_at timestamptz null
);

create unique index if not exists uq_notification_outbox_dedupe on public.notification_outbox(dedupe_key);
create index if not exists idx_notification_outbox_status_created on public.notification_outbox(status, created_at);

create table if not exists public.notification_sends (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references public.notification_outbox(id) on delete set null,
  event_type notification_event_type not null,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  prayer_id uuid not null,
  comment_id uuid null,
  throttle_key text,
  sent_at timestamptz not null default now()
);

create unique index if not exists uq_notification_sends_throttle on public.notification_sends(throttle_key);
create index if not exists idx_notification_sends_target_time on public.notification_sends(target_user_id, sent_at);

-- Pref helpers (default TRUE if null)
create or replace function public.pref_email_on_prayer_like(p_user uuid)
returns boolean language sql stable as $$
  select coalesce((select email_on_prayer_like from public.profiles where id = p_user), true)
$$;

create or replace function public.pref_email_on_prayer_reply(p_user uuid)
returns boolean language sql stable as $$
  select coalesce((select email_on_prayer_reply from public.profiles where id = p_user), true)
$$;

-- LIKE → enqueue only first-ever like from this actor on this prayer
create or replace function public.notify_queue_on_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_dedupe text;
begin
  select author_id into v_owner from public.prayers where id = new.prayer_id;
  if v_owner is null or v_owner = new.user_id then return new; end if;
  if not pref_email_on_prayer_like(v_owner) then return new; end if;

  v_dedupe := 'like:' || new.user_id || ':' || new.prayer_id;

  insert into public.notification_outbox(event_type, actor_user_id, target_user_id, prayer_id, comment_id, payload, dedupe_key)
  values ('prayer_like', new.user_id, v_owner, new.prayer_id, null, '{}'::jsonb, v_dedupe)
  on conflict(dedupe_key) do nothing;

  return new;
end $$;

drop trigger if exists trg_notify_on_like on public.prayer_likes;
create trigger trg_notify_on_like
after insert on public.prayer_likes
for each row execute function public.notify_queue_on_like();

-- REPLY → enqueue at most once per actor per prayer per day (plus runtime throttling)
create or replace function public.notify_queue_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_dedupe text;
  v_day text;
begin
  select author_id into v_owner from public.prayers where id = new.prayer_id;
  if v_owner is null or v_owner = new.author_id then return new; end if;
  if not pref_email_on_prayer_reply(v_owner) then return new; end if;

  v_day := to_char(timezone('utc', now()), 'YYYY-MM-DD');
  v_dedupe := 'reply:' || new.author_id || ':' || new.prayer_id || ':' || v_day;

  insert into public.notification_outbox(event_type, actor_user_id, target_user_id, prayer_id, comment_id, payload, dedupe_key)
  values ('prayer_reply', new.author_id, v_owner, new.prayer_id, new.id, jsonb_build_object('preview', left(new.content, 160)), v_dedupe)
  on conflict(dedupe_key) do nothing;

  return new;
end $$;

drop trigger if exists trg_notify_on_reply on public.prayer_comments;
create trigger trg_notify_on_reply
after insert on public.prayer_comments
for each row execute function public.notify_queue_on_reply();
