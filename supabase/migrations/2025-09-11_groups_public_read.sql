-- Enable RLS on groups and allow public reads
alter table if exists public.groups enable row level security;

do $$
begin
  create policy groups_public_read
    on public.groups
    for select
    using (true);
exception when duplicate_object then null;
end $$;

-- Optional: owners can create/update their groups (safe, additive)
do $$
begin
  create policy groups_owner_insert
    on public.groups
    for insert
    with check (auth.uid() = created_by);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy groups_owner_update
    on public.groups
    for update
    using (auth.uid() = created_by)
    with check (auth.uid() = created_by);
exception when duplicate_object then null;
end $$;

-- Don't add a DELETE policy unless you want users to delete their groups.



-- Enable RLS on group_members so the page can count members.
alter table if exists public.group_members enable row level security;

-- Public read (SELECT) to allow counting membership on the client.
-- NOTE: This exposes membership rows to readers. If you want to avoid that
-- later, we can replace this with a counts VIEW + tighter policy.
do $$
begin
  create policy group_members_public_read
    on public.group_members
    for select
    using (true);
exception when duplicate_object then null;
end $$;
