# Changelog

## [Unreleased]
### Added
- Feed: author byline displayed above Like button; links to `/u/:username` when profile is public, otherwise shows tooltip "profile is private".
- lib: `profileLookup.ts` for batched reading of `profiles (id, username, is_public)`.
- Public route: `/u/:username` shows a simple public profile page.
- Migration: `2025-09-10_profiles_public_read.sql` adds a public-read RLS policy for `profiles` (`is_public = true`).
