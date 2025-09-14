// src/lib/reps.ts
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type Tables = Database['public']['Tables'];
type UserRepInsert = Tables['user_representatives']['Insert'];

/** Minimal DB row shape we read. Keep this decoupled from generated types. */
type RepRowDB = {
  id: string;
  state: string | null;
  office_name: string | null;
  level: string | null;     // 'federal' | 'state' | 'local' | null
  chamber: string | null;   // 'senate' | 'house' | null
  district?: string | null;
};

/** Local view for inference fallback */
type RepLite = { id: string; state: string | null; office: string | null; level: string | null };

/** Parse first 5 digits of ZIP; return number or null */
function zipToNumeric(zip: string): number | null {
  const five = (zip || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(five)) return null;
  return Number(five);
}

/**
 * MVP ZIP→state helper.
 * Currently recognizes Texas by ZIP range (75000–79999). Extend later as needed.
 * Returns two-letter state code or null.
 */
export function zipToState(zip: string | null | undefined): string | null {
  const n = zip ? zipToNumeric(zip) : null;
  if (n === null) return null;
  if (n >= 75000 && n <= 79999) return 'TX';
  return null;
}

/** Infer level from office text if DB level is missing. */
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
 * Ensure the current user has user_representatives rows based on their stored address.
 * Now includes: Federal (2 senators + house by CD) and State (SD + HD) where available.
 * Returns how many mappings were attempted.
 */
export async function assignRepsForCurrentUser(): Promise<{ assigned: number; state: string | null; message?: string }> {
  // must be authed
  const { data: ures, error: uerr } = await supabase.auth.getUser();
  if (uerr || !ures.user) return { assigned: 0, state: null, message: 'Not signed in.' };
  const userId = ures.user.id;

  // fetch user's primary address (include state/cd/sd/hd + zip)
  const { data: addr, error: aerr } = await supabase
    .from('user_addresses')
    .select('postal_code, state, cd, sd, hd')
    .eq('user_id', userId)
    .eq('is_primary', true)
    .maybeSingle();
  if (aerr) return { assigned: 0, state: null, message: aerr.message || 'Address lookup failed.' };

  // derive 2-letter state: prefer saved state; fallback to ZIP heuristic
  const addrState = (addr?.state || '').trim().toUpperCase();
  const state = (addrState && addrState.length === 2) ? addrState : zipToState(addr?.postal_code || null);
  if (!state) return { assigned: 0, state: null, message: 'No state on file (ZIP-only mapping unsupported for this state).' };

  // Gather reps to map
  const reps: RepRowDB[] = [];

  // 1) Federal Senators
  {
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state)
      .eq('level', 'federal')
      .eq('chamber', 'senate');
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (senators).' };
    if (data?.length) reps.push(...data);
  }

  // 2) Federal House by CD (if available)
  if (addr?.cd) {
    const cd = String(addr.cd);
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state)
      .eq('level', 'federal')
      .eq('chamber', 'house')
      .eq('district', cd);
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (house).' };
    if (data?.length) reps.push(...data);
  }

  // 3) State Senator by SD (upper)
  if (addr?.sd) {
    const sd = String(addr.sd);
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state)
      .eq('level', 'state')
      .eq('chamber', 'senate')
      .eq('district', sd);
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (state senate).' };
    if (data?.length) reps.push(...data);
  }

  // 4) State Representative by HD (lower)
  if (addr?.hd) {
    const hd = String(addr.hd);
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state)
      .eq('level', 'state')
      .eq('chamber', 'house')
      .eq('district', hd);
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (state house).' };
    if (data?.length) reps.push(...data);
  }

  // 5) Fallback: if none found yet, include all reps for the state (MVP behavior)
  if (!reps.length) {
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state);
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (fallback).' };
    if (data?.length) reps.push(...data);
  }

  // Map to insertion rows (prefer rep.level; fallback to inference from office_name)
  const rows: UserRepInsert[] = (reps ?? []).map((r: RepRowDB) => {
    const office = r.office_name ?? null;
    const level: UserRepInsert['level'] = (r.level as any) || inferLevelFromOffice(office);
    return {
      user_id: userId,
      rep_id: r.id,
      level,
    };
  });

  if (!rows.length) return { assigned: 0, state, message: 'No representatives found for state.' };

  // Upsert mappings; de-duped by (user_id,rep_id)
  const { error: ierr } = await supabase
    .from('user_representatives')
    .upsert(rows, { onConflict: 'user_id,rep_id' });

  if (ierr) return { assigned: 0, state, message: ierr.message || 'Mapping insert failed.' };
  return { assigned: rows.length, state };
}
