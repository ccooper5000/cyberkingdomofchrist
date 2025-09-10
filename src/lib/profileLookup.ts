// src/lib/profileLookup.ts
// Lightweight batched loader for public profile display info (username + is_public).
// Does not change RLS; gracefully degrades if private profiles are unreadable.

import { supabase } from '@/lib/supabase';

export type PublicProfileInfo = {
  id: string;
  username: string | null;
  is_public: boolean | null;
};

export async function fetchProfilesPublicByIds(
  ids: string[]
): Promise<Record<string, { username: string | null; is_public: boolean | null }>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, is_public')
    .in('id', unique);

  if (error) {
    console.error('[profiles] fetch error:', error);
    return {};
  }

  const map: Record<string, { username: string | null; is_public: boolean | null }> = {};
  for (const row of (data ?? []) as PublicProfileInfo[]) {
    map[row.id] = { username: row.username, is_public: row.is_public };
  }
  return map;
}
