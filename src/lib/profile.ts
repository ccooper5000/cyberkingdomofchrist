// src/lib/profile.ts
// Additive helpers for reading/saving the current user's profile without touching existing UI.
// Safe to import anywhere; integrates with RLS (owner-only writes).

import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export type SaveProfilePayload = {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null; // required only on first insert
  bio?: string | null;
  is_public?: boolean | null;
};

export type FieldName = 'first_name' | 'last_name' | 'username' | 'bio';

export interface SaveResult {
  ok: boolean;
  profile?: ProfileRow;
  fieldErrors?: Partial<Record<FieldName, string>>;
  error?: string; // non-field error (network, auth, etc.)
}

/**
 * Build a display name from first/last (trimmed), falling back gracefully.
 */
export function deriveDisplayName(first?: string | null, last?: string | null): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  const parts = [f, l].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Friend';
}

/**
 * Get the current user's profile row (owner-only via RLS).
 */
export async function getMyProfile(): Promise<{ data: ProfileRow | null; error: Error | null }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return { data: null, error: new Error('not_authenticated') };
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .single();
  return { data: data ?? null, error };
}

/**
 * Check if a username is available (lowercase-only enforced by DB trigger).
 * Returns true when no profile has this exact username.
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('username', username);
  if (error) {
    throw error;
  }
  return (count ?? 0) === 0;
}

/**
 * Save (insert or update) the current user's profile.
 * - INSERT path requires username (because your current types require it).
 * - UPDATE path only changes provided fields.
 * - Maps DB constraint errors into fieldErrors for friendly UI messages.
 * - Refreshes localStorage display name used by AuthMessages.tsx.
 */
export async function saveMyProfile(payload: SaveProfilePayload): Promise<SaveResult> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return { ok: false, error: 'not_authenticated' };
  }

  // Fetch existing profile row (typed to current schema).
  const { data: existing, error: readErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (readErr) {
    return { ok: false, error: readErr.message };
  }

  // Helper for consistent error mapping.
  const mapError = (error: any): SaveResult => {
    const fieldErrors: SaveResult['fieldErrors'] = {};
    const code = error?.code as string | undefined;
    const msg = error?.message as string | undefined;

    if (code === '23505' || (msg && msg.includes('profiles_username_lower_unique_idx'))) {
      fieldErrors.username = 'That username is already taken.';
    } else if (code === '23514') {
      if (msg?.toLowerCase().includes('first name')) fieldErrors.first_name = 'First name too long (max 50).';
      else if (msg?.toLowerCase().includes('last name')) fieldErrors.last_name = 'Last name too long (max 50).';
      else if (msg?.toLowerCase().includes('bio')) fieldErrors.bio = 'Bio too long (max 2000).';
      else fieldErrors.username = 'Invalid username format (use 3–24 lowercase letters, numbers, or underscores).';
    } else if (code === '22000') {
      if (msg?.includes('first_name')) fieldErrors.first_name = 'Contains disallowed content.';
      else if (msg?.includes('last_name')) fieldErrors.last_name = 'Contains disallowed content.';
      else if (msg?.includes('username')) fieldErrors.username = 'Contains disallowed content.';
      else if (msg?.includes('bio')) fieldErrors.bio = 'Contains disallowed content.';
      else return { ok: false, error: msg ?? 'Invalid content.' };
    } else if (msg?.toLowerCase().includes('username must be 3–24')) {
      fieldErrors.username = 'Invalid username format (use 3–24 lowercase letters, numbers, or underscores).';
    } else {
      return { ok: false, error: msg ?? 'Unknown error' };
    }
    return { ok: false, fieldErrors };
  };

  // Decide INSERT vs UPDATE
  if (!existing) {
    // INSERT requires username per your current types.
    const uname = payload.username ?? '';
    if (!/^[a-z0-9_]{3,24}$/.test(uname)) {
      return { ok: false, fieldErrors: { username: 'Choose a username (3–24 lowercase letters, numbers, or underscores).' } };
    }

    // Build display name from payload names (or fall back to username).
    const display_name = deriveDisplayName(payload.first_name ?? null, payload.last_name ?? null) || uname;

    // Build insert object. Use `any` for new columns not in current TypeScript schema yet.
    const insert: any = {
      id: auth.user.id,
      username: uname,
      display_name,
    };
    if (payload.first_name !== undefined) insert.first_name = payload.first_name;
    if (payload.last_name !== undefined) insert.last_name = payload.last_name;
    if (payload.bio !== undefined) insert.bio = payload.bio;
    if (payload.is_public !== undefined) insert.is_public = payload.is_public;

    const { data, error } = await supabase
      .from('profiles')
      .insert(insert)
      .select('*')
      .single();

    if (error) return mapError(error);

    // Update cached display name
    try {
      const name = (data as any)?.display_name || display_name;
      if (name) localStorage.setItem('ckoc_last_display_name', name);
    } catch {}

    return { ok: true, profile: data as ProfileRow };
  }

  // UPDATE existing: only send fields provided. Using `any` to include new columns.
  const update: any = {};
  if (payload.username !== undefined) update.username = payload.username;
  if (payload.first_name !== undefined) update.first_name = payload.first_name;
  if (payload.last_name !== undefined) update.last_name = payload.last_name;
  if (payload.bio !== undefined) update.bio = payload.bio;
  if (payload.is_public !== undefined) update.is_public = payload.is_public;

  // If first/last change, also refresh display_name.
  if (payload.first_name !== undefined || payload.last_name !== undefined) {
    const currentFirst = (existing as any)?.first_name ?? null;
    const currentLast = (existing as any)?.last_name ?? null;
    const first = payload.first_name ?? currentFirst;
    const last = payload.last_name ?? currentLast;
    update.display_name = deriveDisplayName(first, last);
  }

  // If nothing to update, return early.
  if (Object.keys(update).length === 0) {
    return { ok: true, profile: existing as ProfileRow };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', auth.user.id)
    .select('*')
    .single();

  if (error) return mapError(error);

  // Update cached display name
  try {
    const name = (data as any)?.display_name || (existing as any)?.display_name || '';
    if (name) localStorage.setItem('ckoc_last_display_name', name);
  } catch {}

  return { ok: true, profile: data as ProfileRow };
}

/**
 * Stash pending profile fields (used when email confirmation is ON and we can't write immediately).
 */
export function setPendingProfileLocal(payload: SaveProfilePayload): void {
  try {
    localStorage.setItem('ckoc_pending_profile', JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

/**
 * Apply and clear any pending profile fields after the user signs in (post-confirmation).
 * Safe to call on every sign-in; it will no-op if nothing is pending.
 */
export async function applyPendingProfileFromLocalStorage(): Promise<SaveResult | { ok: true; skipped: true }> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem('ckoc_pending_profile');
  } catch {}
  if (!raw) return { ok: true, skipped: true };

  let payload: SaveProfilePayload | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    try { localStorage.removeItem('ckoc_pending_profile'); } catch {}
    return { ok: true, skipped: true };
  }

  const res = await saveMyProfile(payload ?? {});
  if (res.ok) {
    try { localStorage.removeItem('ckoc_pending_profile'); } catch {}
  }
  return res;
}
