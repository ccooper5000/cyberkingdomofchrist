-- Additive: safe if re-run; does not change existing behavior
alter table public.profiles
  add column if not exists email_on_prayer_like  boolean not null default true,
  add column if not exists email_on_prayer_reply boolean not null default true;
