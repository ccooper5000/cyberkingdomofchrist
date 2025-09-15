// netlify/functions/reps-sync.ts
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

/**
 * Seeds U.S. Senators (by state) and the U.S. House member (by state+district)
 * from Congress.gov v3. This file is FEDERAL-ONLY. It does not touch state-level code.
 *
 * Env:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - CONGRESS_API_KEY
 *
 * Usage:
 *  GET /.netlify/functions/reps-sync?state=TX
 *  GET /.netlify/functions/reps-sync?state=TX&house_district=21
 */

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY as string;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

// ── HTTP helpers (privacy-safe) ──────────────────────────────────────────────
const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};
const J = (o: any) => JSON.stringify(o);

const apiURL = (path: string, params: Record<string, string | number | boolean | undefined>) => {
  const u = new URL(`https://api.congress.gov/v3/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  u.searchParams.set('api_key', CONGRESS_API_KEY);
  u.searchParams.set('format', 'json');
  return u.toString();
};

const fetchJSON = async (url: string) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} :: ${t.slice(0, 240)}`);
  }
  return r.json();
};

// ── extraction helpers (resilient to schema drift) ───────────────────────────
const pick = (...vals: any[]) => { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return null; };

const getMembersFrom = (js: any): any[] =>
  (js?.members ?? js?.data?.members ?? js?.results ?? js?.data?.results ?? js?.items ?? js?.value ?? []);

const currentTermOf = (m: any) => {
  const terms: any[] = Array.isArray(m?.terms) ? m.terms : [];
  return terms.find(t => t?.current === true || t?.endYear == null) || null;
};

const memberDistrict = (m: any): string | null => {
  const cur = currentTermOf(m);
  const d = pick(m.district, m.cd, m.congressionalDistrict, m.currentDistrict, cur?.district);
  if (d === 0 || d === '0') return 'At-Large';
  return d != null ? String(d) : null;
};

const memberStateCode = (m: any): string | null => {
  const cur = currentTermOf(m);
  const s = pick(
    m.stateCode, m.state, m.stateAbbrev, m.state_abbrev, m.state_abbr,
    m.state_name, m.stateName, m.address?.state, cur?.stateCode, cur?.state
  );
  return s ? String(s).toUpperCase() : null;
};

const detectChamber = (m: any): 'senate' | 'house' | null => {
  const cur = currentTermOf(m);
  const explicit = String(pick(cur?.chamber, m.chamber, m.chamberName, m.role, m.memberType, m.title, m.position) || '').toLowerCase();
  if (explicit.includes('sen')) return 'senate';
  if (explicit.includes('house') || explicit.includes('rep')) return 'house';
  // Fallback: district present => House; otherwise Senate
  return memberDistrict(m) == null ? 'senate' : 'house';
};

const memberName = (m: any): string =>
  (pick(m.name, `${pick(m.firstName, m.first_name, '')} ${pick(m.lastName, m.last_name, '')}`) || '').toString().trim();

// ── OCD division IDs (your schema requires division_id NOT NULL) ─────────────
const stateDivisionId = (state: string) => `ocd-division/country:us/state:${state.toLowerCase()}`;
const normalizeCd = (district: string) => {
  const s = String(district).trim().toLowerCase();
  if (s === 'at-large' || s === 'at large' || s === 'atlarge') return '1';
  const m = s.match(/\d+/);
  return m ? m[0] : '1';
};
const houseDivisionId = (state: string, district: string) =>
  `ocd-division/country:us/state:${state.toLowerCase()}/cd:${normalizeCd(district)}`;

// ── DB helpers (federal-scoped deletes; cannot touch state rows) ─────────────
async function clearSlot(state: string, chamber: 'senate' | 'house', district?: string | null) {
  if (chamber === 'senate') {
    await supabase!.from('representatives').delete()
      .eq('level', 'federal').eq('chamber', 'senate').eq('state', state);
  } else {
    await supabase!.from('representatives').delete()
      .eq('level', 'federal').eq('chamber', 'house').eq('state', state).eq('district', district ?? null);
  }
}

// ── fetchers with multi-endpoint fallback ────────────────────────────────────
async function fetchSenatorsForState(state: string): Promise<any[]> {
  // Preferred: state path endpoint
  const urls: string[] = [
    apiURL(`member/${state}`, { currentMember: true, limit: 250 }),
    apiURL('member',          { state, currentMember: true, limit: 500 }),
    apiURL('member',          { chamber: 'Senate', currentMember: true, limit: 500 }),
  ];

  const collected: any[] = [];
  for (const u of urls) {
    try {
      const js = await fetchJSON(u);
      const list = getMembersFrom(js);
      for (const m of list) {
        if ((memberStateCode(m) ?? state) !== state) continue;
        if (detectChamber(m) !== 'senate') continue;
        collected.push(m);
      }
      if (collected.length >= 2) break;
    } catch {
      // Try next endpoint
    }
  }
  // Return at most 2
  return collected.slice(0, 2);
}

async function fetchHouseForDistrict(state: string, district: string): Promise<any[]> {
  const urls: string[] = [
    apiURL(`member/${state}/${district}`, { currentMember: true, limit: 50 }),
    apiURL('member',                      { state, district, currentMember: true, limit: 50 }),
    apiURL('member',                      { state, currentMember: true, limit: 500 }),
  ];

  for (const u of urls) {
    try {
      const js = await fetchJSON(u);
      const list = getMembersFrom(js);
      const house = list
        .filter(m => (memberStateCode(m) ?? state) === state)
        .filter(m => {
          const d = memberDistrict(m) ?? district;
          return String(d) === String(district);
        })
        .filter(m => detectChamber(m) === 'house');
      if (house.length) return house;
    } catch {
      // try next
    }
  }
  return [];
}

// ── handler ──────────────────────────────────────────────────────────────────
export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: H, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: H, body: J({ error: 'Use GET' }) };

    const miss: string[] = [];
    if (!supabase) miss.push('Supabase init');
    if (!SUPABASE_URL) miss.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!CONGRESS_API_KEY) miss.push('CONGRESS_API_KEY');
    if (miss.length) return { statusCode: 500, headers: H, body: J({ error: `Missing env: ${miss.join(', ')}` }) };

    const qs = event.queryStringParameters || {};
    const state = String(qs.state || '').toUpperCase();
    const districtRaw = String(qs.house_district || '').trim();

    if (!/^[A-Z]{2}$/.test(state)) {
      return { statusCode: 400, headers: H, body: J({ error: 'Provide ?state=XX (two-letter code)' }) };
    }

    // 1) Seed U.S. Senators
    const senators = await fetchSenatorsForState(state);
    await clearSlot(state, 'senate');
    let senateSeeded = 0;
    if (senators.length) {
      const rows = senators.map(m => ({
        level: 'federal',
        chamber: 'senate',
        state,
        district: null,
        division_id: stateDivisionId(state), // NOT NULL
        name: memberName(m),
        office_name: 'U.S. Senator',
        email: null,
        contact_email: null,
        contact_form_url: pick(m.contactUrl, m.contactURL, m.url, m.website, m.officialWebsiteUrl) || null,
        source: 'congress.gov',
      }));
      const { error } = await supabase!.from('representatives').insert(rows);
      if (error) throw new Error(`Supabase insert (senate) failed: ${error.message}`);
      senateSeeded = rows.length;
    }

    // 2) Seed U.S. House (if district provided)
    let houseSeeded = 0;
    if (districtRaw) {
      const district = districtRaw.toLowerCase() === 'at-large' ? 'At-Large' : districtRaw;
      const house = await fetchHouseForDistrict(state, district);
      await clearSlot(state, 'house', district);
      if (house.length) {
        const rows = house.map(m => {
          const d = memberDistrict(m) ?? district;
          return {
            level: 'federal',
            chamber: 'house',
            state,
            district: d,
            division_id: houseDivisionId(state, d),
            name: memberName(m),
            office_name: 'U.S. Representative',
            email: null,
            contact_email: null,
            contact_form_url: pick(m.contactUrl, m.contactURL, m.url, m.website, m.officialWebsiteUrl) || null,
            source: 'congress.gov',
          };
        });
        const { error } = await supabase!.from('representatives').insert(rows);
        if (error) throw new Error(`Supabase insert (house) failed: ${error.message}`);
        houseSeeded = rows.length;
      }
    }

    // Privacy-safe debug
    return {
      statusCode: 200,
      headers: H,
      body: J({ ok: true, debug: { state, senateSeeded, houseDistrict: districtRaw || null, houseSeeded } }),
    };
  } catch (e: any) {
    return { statusCode: 500, headers: H, body: J({ error: e?.message || 'Server error' }) };
  }
};

export default handler;
