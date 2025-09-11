# Changelog

## [Unreleased]
### Added
- Feed: author byline displayed above Like button; links to `/u/:username` when profile is public, otherwise shows tooltip "profile is private".
- lib: `profileLookup.ts` for batched reading of `profiles (id, username, is_public)`.
- Public route: `/u/:username` shows a simple public profile page.
- Migration: `2025-09-10_profiles_public_read.sql` adds a public-read RLS policy for `profiles` (`is_public = true`).
- Public Profile page: lists the user’s prayers (single fetch, newest first; up to 100 items), relying on RLS for public/legacy rows.
- Groups index page (`/groups`): loads real `groups` + client-side member counts from `group_members`; card titles link to `/g/:id`; “Create Group” links to `/groups/new`.
- Group page (`/g/:id`): read-only header (name, description, member count) and the group’s prayers; author bylines use public profiles.
- Join/Leave group: UI + self-scoped RLS policies (users can insert/delete their own `group_members` row).
- Create Group page (`/groups/new`): creates a group with `created_by = current user`, adds owner membership, then redirects to `/g/:id`.

### Changed
- Feed byline copy: now reads **“Posted by <username>”** (still links for public profiles; private shows tooltip).

### Database / Security
- `2025-09-10_prayers_public_read.sql`: enable RLS on `public.prayers`; allow `SELECT` where `visibility = 'public' OR visibility IS NULL`.
- `2025-09-10_linter_fixes.sql`: set `security_invoker = true` on `public.prayer_feed`; enable RLS on `public.user_daily_limits` (owner `SELECT/INSERT/UPDATE` policies); enable RLS on `public.banned_terms` (public `SELECT`, writes blocked).
- `2025-09-11_groups_public_read.sql`: enable RLS on `public.groups`; add `groups_public_read`; optional owner `INSERT/UPDATE` policies.
- `2025-09-11_group_members_self_join_leave.sql`: enable RLS on `public.group_members`; add `group_members_public_read`; self `INSERT` (join) and self `DELETE` (leave) policies.
- `2025-09-11_groups_create_policies.sql`: ensure `groups_owner_insert` (creator must match `auth.uid()`), and `group_members_self_insert` (owner membership on create).

