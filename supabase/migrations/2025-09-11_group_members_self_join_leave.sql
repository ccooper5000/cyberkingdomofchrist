-- Ensure RLS is on (safe if already enabled)
alter table if exists public.group_members enable row level security;

-- Public read exists from earlier step; keep it. (If not, re-create.)
do $$
begin
  create policy group_members_public_read
    on public.group_members
    for select
    using (true);
exception when duplicate_object then null;
end $$;

-- Allow any authenticated user to JOIN (insert their own membership row)
do $$
begin
  create policy group_members_self_insert
    on public.group_members
    for insert
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- Allow any authenticated user to LEAVE (delete their own membership row)
do $$
begin
  create policy group_members_self_delete
    on public.group_members
    for delete
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- (We are intentionally NOT allowing update or deleting others' rows.)
