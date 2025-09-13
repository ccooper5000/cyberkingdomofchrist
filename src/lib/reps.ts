// src/lib/reps.ts
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type Tables = Database['public']['Tables'];
// NOTE: Your generated types still list `office` (stale) instead of `office_name`.
// We'll avoid relying on that here.

// Minimal runtime row shape we actually read from the DB:
type RepRowDB = { id: string; state: string | null; office_name: string | null };

// Local view used by our logic (keeps the rest of code unchanged)
type RepLite = { id: string; state: string | null; office: string | null };

type UserRepInsert = Tables['user_representatives']['Insert'];

function zipToNumeric(zip: string): number | null {
  const five = (zip || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(five)) return null;
  return Number(five);
}

/** MVP mapping: return 'TX' if ZIP is in 75000–79999; otherwise null. */
export function zipToState(zip: string | null | undefined): 'TX' | null {
  const n = zip ? zipToNumeric(zip) : null;
  if (n === null) return null;
  return n >= 75000 && n <= 79999 ? 'TX' : null;
}

/** Infer representative level from the 'office' text (fallback to 'local'). */
function inferLevelFromOffice(office: string | null): UserRepInsert['level'] {
  const o = (office || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  if (
    (o.includes('united states') && (
      o.includes('senate') || o.includes('senator') ||
      o.includes('house') || o.includes('representative') ||
      o.includes('congress')
    )) ||
    o.includes('us senate') || o.includes('u s senate') ||
    o.includes('us senator') || o.includes('u s senator') ||
    o.includes('us house') || o.includes('u s house') ||
    o.includes('us representative') || o.includes('u s representative') ||
    o.includes('president') || o.includes('white house')
  ) {
    return 'federal';
  }

  if (
    o.includes('state senator') || o.includes('state senate') ||
    o.includes('state representative') || o.includes('state house') ||
    o.includes('state assembly') || o.includes('general assembly') ||
    o.includes('legislature') ||
    o.includes('texas senate') || o.includes('texas house')
  ) {
    return 'state';
  }

  return 'local';
}

/**
 * Ensure the current user has user_representatives rows based on their stored ZIP.
 * MVP: if ZIP is a Texas ZIP, link all reps where state='TX' (seeded reps).
 * Returns how many mappings were attempted.
 */
export async function assignRepsForCurrentUser(): Promise<{ assigned: number; state: string | null; message?: string }> {
  // must be authed
  const { data: ures, error: uerr } = await supabase.auth.getUser();
  if (uerr || !ures.user) return { assigned: 0, state: null, message: 'Not signed in.' };
  const userId = ures.user.id;

  // fetch user's primary ZIP
  const { data: addr, error: aerr } = await supabase
    .from('user_addresses')
    .select('postal_code')
    .eq('user_id', userId)
    .eq('is_primary', true)
    .maybeSingle();
  if (aerr) return { assigned: 0, state: null, message: aerr.message || 'ZIP lookup failed.' };

  const state = zipToState(addr?.postal_code || null);
  if (!state) return { assigned: 0, state: null, message: 'ZIP not supported in MVP mapping.' };

  // IMPORTANT:
  // - We select real DB columns: id, state, office_name
  // - We intentionally bypass the stale generated types with `as any`
  const { data: reps, error: rerr } = await (supabase as any)
    .from('representatives')
    .select('id, state, office_name')
    .eq('state', state);

  if (rerr) return { assigned: 0, state, message: rerr.message || 'Representative fetch failed.' };

  const repsLite: RepLite[] = ((reps as RepRowDB[]) ?? []).map((r) => ({
    id: r.id,
    state: r.state ?? null,
    office: r.office_name ?? null,
  }));

  if (!repsLite.length) return { assigned: 0, state, message: 'No seeded reps found for state.' };

  const rows: UserRepInsert[] = repsLite.map((r) => ({
    user_id: userId,
    rep_id: r.id,
    level: inferLevelFromOffice(r.office),
  }));

  // upsert mappings (RLS: user can insert only their own). De-duped by (user_id, rep_id) unique index.
  const { error: ierr } = await supabase
    .from('user_representatives')
    .upsert(rows, { onConflict: 'user_id,rep_id' });

  if (ierr) return { assigned: 0, state, message: ierr.message || 'Mapping insert failed.' };
  return { assigned: rows.length, state };
}
