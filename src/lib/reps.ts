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
  chamber: string | null;   // for federal: 'senate' | 'house'; for state: 'upper' | 'lower'
  district?: string | null; // numeric string like "10"
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
 * ZIP→state helper (legacy). Not used for mapping anymore, but kept for any callers.
 * Returns two-letter state code or null.
 */
export function zipToState(zip: string | null | undefined): string | null {
  const n = zip ? zipToNumeric(zip) : null;
  if (n === null) return null;
  // NOTE: previously special-cased TX; mapping now relies on saved districts instead.
  if (n >= 75000 && n <= 79999) return 'TX';
  return null;
}

// src/lib/reps.ts  (add below zipToState)
/** Ensure the representatives table is populated for this user's geographies. */
async function ensureRepsSeeded(
  state: string,
  cd?: string | null,
  sd?: string | null,
  hd?: string | null
): Promise<void> {
  try {
    // Minimal presence checks
    const { data: sens } = await (supabase as any)
      .from('representatives')
      .select('id')
      .eq('state', state)
      .eq('level', 'federal')
      .eq('chamber', 'senate');

    const needFederal = !sens || sens.length < 2;

    let needHouse = false;
    if (cd && cd !== 'At-Large') {
      const { data: house } = await (supabase as any)
        .from('representatives')
        .select('id')
        .eq('state', state)
        .eq('level', 'federal')
        .eq('chamber', 'house')
        .eq('district', String(cd));
      needHouse = !house || house.length === 0;
    }

    let needState = false;
    if (sd || hd) {
      const checks: Promise<any>[] = [];
      if (sd) {
        checks.push(
          (supabase as any).from('representatives').select('id')
            .eq('state', state).eq('level', 'state').eq('chamber', 'senate').eq('district', String(sd))
        );
      }
      if (hd) {
        checks.push(
          (supabase as any).from('representatives').select('id')
            .eq('state', state).eq('level', 'state').eq('chamber', 'house').eq('district', String(hd))
        );
      }
      const results = await Promise.all(checks);
      needState = results.some(r => !r?.data || r.data.length === 0);
    }

    // Seed federal (senators + optional House district)
    if (needFederal || needHouse) {
      const qs = new URLSearchParams({ state });
      if (cd && cd !== 'At-Large') qs.set('house_district', String(cd));
      await fetch(`/.netlify/functions/reps-sync?${qs.toString()}`);
      // reps-sync upserts by stable person id, so repeated runs just refresh data.
    }

    // Seed state legislators (if we know sd/hd)
    if (sd || hd) {
      const qs2 = new URLSearchParams({ state });
      if (sd) qs2.set('sd', String(sd));
      if (hd) qs2.set('hd', String(hd));
      await fetch(`/.netlify/functions/state-reps-sync?${qs2.toString()}`);
    }
  } catch {
    // Best-effort: if seeding fails, the rest of assignRepsForCurrentUser will still try to map whatever exists.
  }
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
 * Uses: Federal (2 senators + house by CD) and State (upper SD + lower HD) where available.
 * Removes any previously mapped sample/legacy reps before inserting fresh ones.
 */
export async function assignRepsForCurrentUser(): Promise<{ assigned: number; state: string | null; message?: string }> {
  // must be authed
  const { data: ures, error: uerr } = await supabase.auth.getUser();
  if (uerr || !ures.user) return { assigned: 0, state: null, message: 'Not signed in.' };
  const userId = ures.user.id;

  // fetch user's primary address (include state/cd/sd/hd)
  const { data: addr, error: aerr } = await supabase
    .from('user_addresses')
    .select('state, cd, sd, hd')
    .eq('user_id', userId)
    .eq('is_primary', true)
    .maybeSingle();
  if (aerr) return { assigned: 0, state: null, message: aerr.message || 'Address lookup failed.' };

  // require a two-letter state; rely on saved districts (no more TX-heuristic fallback)
  const state = (addr?.state || '').trim().toUpperCase() || null;
  if (!state) return { assigned: 0, state: null, message: 'No state on file; run district detection and save.' };
  // Ensure DB has real rows for this user's geographies before mapping
await ensureRepsSeeded(state, addr?.cd ?? null, addr?.sd ?? null, addr?.hd ?? null);


  const cd = addr?.cd ? String(addr.cd) : null; // U.S. House district
  const sd = addr?.sd ? String(addr.sd) : null; // State senate (upper)
  const hd = addr?.hd ? String(addr.hd) : null; // State house (lower)

  const repIds: string[] = [];

  // 1) U.S. Senators (federal senate) — always by state
  {
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state)
      .eq('level', 'federal')
      .eq('chamber', 'senate')
      .limit(5);
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (federal senate).' };
    if (data?.length) repIds.push(...data.map((r: RepRowDB) => r.id));
  }

  // 2) U.S. House (federal house) — by CD
  if (cd) {
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state)
      .eq('level', 'federal')
      .eq('chamber', 'house')
      .eq('district', cd)
      .limit(5);
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (federal house).' };
    if (data?.length) repIds.push(...data.map((r: RepRowDB) => r.id));
  }

  // 3) State Senate (upper) — by SD
  if (sd) {
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state)
      .eq('level', 'state')
      // support both schema styles: 'upper' OR title contains 'senate'
      .or('chamber.eq.upper,office_name.ilike.%senate%')
      .eq('district', sd)
      .limit(5);
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (state senate).' };
    if (data?.length) repIds.push(...data.map((r: RepRowDB) => r.id));
  }

  // 4) State House (lower) — by HD
  if (hd) {
    const { data, error } = await (supabase as any)
      .from('representatives')
      .select('id, state, office_name, level, chamber, district')
      .eq('state', state)
      .eq('level', 'state')
      // support both schema styles: 'lower' OR title contains 'representative'
      .or('chamber.eq.lower,office_name.ilike.%representative%')
      .eq('district', hd)
      .limit(5);
    if (error) return { assigned: 0, state, message: error.message || 'Representative fetch failed (state house).' };
    if (data?.length) repIds.push(...data.map((r: RepRowDB) => r.id));
  }

  // Require at least one match; DO NOT fall back to "all state reps" (avoids showing sample/irrelevant officials)
  const uniqueIds = Array.from(new Set(repIds));
  if (uniqueIds.length === 0) {
    return { assigned: 0, state, message: 'No matching representatives found for your districts. Re-run district detection.' };
  }

  // 5) Replace any previous mappings for this user (clears old/sample rows)
  const { error: delErr } = await supabase
    .from('user_representatives')
    .delete()
    .eq('user_id', userId);
  if (delErr) {
    // If RLS blocks delete, we can still proceed with upsert-only, but the UI may show stale reps.
    // Report but continue so we at least insert the correct set.
    console.warn('user_representatives delete failed:', delErr.message);
  }

  // 6) Fetch minimal metadata so every row can include a required 'level'
  const { data: levelRows, error: lrErr } = await (supabase as any)
    .from('representatives')
    .select('id, office_name, level')
    .in('id', uniqueIds);
  if (lrErr) {
    return { assigned: 0, state, message: lrErr.message || 'Failed to load representative metadata.' };
  }

  const byId = new Map<string, { office_name: string | null; level: string | null }>();
  for (const r of levelRows ?? []) {
    byId.set(r.id, { office_name: r.office_name ?? null, level: r.level ?? null });
  }

  // 7) Build rows with a concrete 'level' (type requires it)
  const rows: UserRepInsert[] = uniqueIds.map((id) => {
    const meta = byId.get(id);
    const lvl = ((meta?.level as UserRepInsert['level']) || inferLevelFromOffice(meta?.office_name ?? null)) as UserRepInsert['level'];
    return { user_id: userId, rep_id: id, level: lvl };
  });

  // 8) Bulk upsert
  const { error: upErr } = await supabase
    .from('user_representatives')
    .upsert(rows, { onConflict: 'user_id,rep_id' });

  if (upErr) return { assigned: 0, state, message: upErr.message || 'Mapping insert failed.' };
  return { assigned: rows.length, state };
}
