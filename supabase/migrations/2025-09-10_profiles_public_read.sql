-- Enable RLS (safe if already enabled)
alter table public.profiles enable row level security;

-- Public read of profiles when the owner marked it public.
-- Guard against duplicate policy creation.
do $$
begin
  create policy profiles_public_read
    on public.profiles
    for select
    using (is_public = true);
exception
  when duplicate_object then null;
end $$;

-- (Optional) Owner read policy if you don't already have one.
-- Uncomment if needed; otherwise leave it out to avoid duplicates.
-- do $$
-- begin
--   create policy profiles_owner_read
--     on public.profiles
--     for select
--     using (auth.uid() = id);
-- exception
--   when duplicate_object then null;
-- end $$;
