// src/lib/zip.ts
import { supabase } from '@/lib/supabase';

/** Return type for setting the primary ZIP. */
export type EnsureZipResult = {
  ok: boolean;
  /** Present when caller must be authenticated first. */
  needsAuth?: boolean;
  /** Present when a primary ZIP already exists (locked) */
  locked?: boolean;
  /** Error/details message when ok=false */
  message?: string;
};

/** Sanitize a username base: lowercase, letters/numbers/underscore only; clamp length. */
function sanitizeBaseUsername(input: string): string {
  const base = (input || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const trimmed = base.slice(0, 24);
  return trimmed.length >= 3 ? trimmed : trimmed.padEnd(3, '0');
}

async function usernameExists(username: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (error && (error as any).code !== 'PGRST116') throw error;
  return !!data?.id;
}

async function computeUniqueUsername(email: string | null, userId: string): Promise<string> {
  const localPart = (email || '').split('@')[0] || '';
  let candidate = sanitizeBaseUsername(localPart) || `user_${userId.slice(0, 6)}`;

  if (await usernameExists(candidate)) {
    const suffix1 = userId.slice(-4);
    candidate = `${candidate}_${suffix1}`.slice(0, 24);
    if (await usernameExists(candidate)) {
      const suffix2 = userId.slice(0, 4);
      candidate = `${candidate}_${suffix2}`.slice(0, 24);
      if (await usernameExists(candidate)) {
        candidate = `user_${userId.slice(0, 8)}`;
      }
    }
  }
  return candidate;
}

async function ensureProfileForCurrentUser(): Promise<{ ok: boolean; message?: string }> {
  const { data: ures, error: uerr } = await supabase.auth.getUser();
  if (uerr || !ures.user) {
    return { ok: false, message: 'Not signed in.' };
  }
  const user = ures.user;
  const userId = user.id;

  // Look up existing profile
  const { data: existing, error: selErr } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .eq('id', userId)
    .maybeSingle();
  if (selErr && (selErr as any).code !== 'PGRST116') {
    return { ok: false, message: selErr.message || 'Profile lookup failed.' };
  }

  if (existing?.id) {
    const needsUsername = !existing.username;
    const needsDisplay = !existing.display_name;
    if (!needsUsername && !needsDisplay) return { ok: true };

    const username = needsUsername
      ? await computeUniqueUsername(user.email ?? null, userId)
      : existing.username!;
    const display_name = needsDisplay
      ? (user.email?.split('@')[0] || username)
      : existing.display_name!;

    const { error: updErr } = await supabase
      .from('profiles')
      .update({ username, display_name })
      .eq('id', userId);
    if (updErr) return { ok: false, message: updErr.message || 'Profile update failed.' };
    return { ok: true };
  }

  // Create a new profile with required fields
  const username = await computeUniqueUsername(user.email ?? null, userId);
  const display_name = user.email?.split('@')[0] || username;

  const { error: insErr } = await supabase
    .from('profiles')
    .insert({ id: userId, username, display_name });
  if (insErr) return { ok: false, message: insErr.message || 'Profile insert failed.' };

  return { ok: true };
}

/** Ensure a single, primary US ZIP is set for the current user. */
export async function ensurePrimaryZip(zip: string): Promise<EnsureZipResult> {
  // must be authed (RLS needs auth.uid())
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) {
    return { ok: false, needsAuth: true, message: 'Not signed in yet.' };
  }
  const userId = userRes.user.id;

  // create/repair profile first (fixes NOT NULL on profiles.username)
  const prof = await ensureProfileForCurrentUser();
  if (!prof.ok) return { ok: false, message: prof.message || 'Profile not ready.' };

  // if primary exists → do NOT modify on client
  const { data: existing, error: selErr } = await supabase
    .from('user_addresses')
    .select('id, postal_code')
    .eq('user_id', userId)
    .eq('is_primary', true)
    .maybeSingle();

  if (selErr && (selErr as any).code !== 'PGRST116') {
    return { ok: false, message: selErr.message || 'Address check failed.' };
  }
  if (existing?.id) {
    const same = (existing.postal_code || '') === zip;
    return {
      ok: same,
      locked: true,
      message: same ? 'ZIP already set.' : 'ZIP already set and locked. Admin change required.',
    };
  }

  // insert primary ZIP (RLS allows INSERT for auth.uid())
  const { error: insErr } = await supabase.from('user_addresses').insert({
    user_id: userId,
    line1: null,
    line2: null,
    city: null,
    state: null,
    postal_code: zip,
    country: 'US',
    cd: null,
    sd: null,
    hd: null,
    muni: null,
    is_primary: true,
  });

  if (insErr) return { ok: false, message: insErr.message || 'Insert failed.' };
  return { ok: true };
}
