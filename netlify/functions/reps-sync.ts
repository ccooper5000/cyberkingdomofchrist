// netlify/functions/reps-sync.ts
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

/**
 * Seeds U.S. Senators (by state) and the U.S. Representative (by state+district)
 * from Congress.gov v3. Does NOT affect state-level code (OpenStates).
 *
 * Env (unchanged elsewhere):
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - CONGRESS_API_KEY
 *
 * Usage (examples):
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

const H = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};
const J = (o: any) => JSON.stringify(o);

// ── Congress.gov helpers ─────────────────────────────────────────────────────
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

const pick = (...vals: any[]) => { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return null; };

const currentTermOf = (m: any) => {
  const terms: any[] = Array.isArray(m.terms) ? m.terms : [];
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
    m.state_name, m.stateName, m.address?.state,
    cur?.stateCode, cur?.state
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

// ── OCD division ID (NOT NULL in your schema) ─────────────────────────────────
const stateDivisionId = (state: string) => `ocd-division/country:us/state:${state.toLowerCase()}`;
const normalizeCd = (district: string) => {
  const s = String(district).trim().toLowerCase();
  if (s === 'at-large' || s === 'at large' || s === 'atlarge') return '1';
  const m = s.match(/\d+/);
  return m ? m[0] : '1';
};
const houseDivisionId = (state: string, district: string) =>
  `ocd-division/country:us/state:${state.toLowerCase()}/cd:${normalizeCd(district)}`;

// ── DB helpers ────────────────────────────────────────────────────────────────
async function clearSlot(state: string, chamber: 'senate' | 'house', district?: string | null) {
  if (chamber === 'senate') {
    await supabase!.from('representatives').delete().eq('level', 'federal').eq('chamber', 'senate').eq('state', state);
  } else {
    await supabase!.from('representatives').delete()
      .eq('level', 'federal').eq('chamber', 'house').eq('state', state).eq('district', district ?? null);
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────
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

    // ── 1) U.S. SENATORS ────────────────────────────────────────────────────
    // Try state-path endpoint, then fall back to a chamber query.
    const urlSenPath = apiURL(`member/${state}`, { currentMember: true, limit: 250 });
    const jsSenPath = await fetchJSON(urlSenPath);
    const listPath: any[] = (jsSenPath?.members ?? jsSenPath?.data?.members ?? jsSenPath?.results ?? []);

    const pathSenators = listPath
      // defensive: ensure the row looks like this state & senate
      .filter(m => (memberStateCode(m) ?? state) === state)
      .filter(m => detectChamber(m) === 'senate');

    let finalSenators = pathSenators;
    let usedFallbackForSen = false;

    if (finalSenators.length < 2) {
      // Fallback: pull across all senators, filter by state
      const urlSenQuery = apiURL('member', { chamber: 'Senate', currentMember: true, limit: 500 });
      const jsSenQuery = await fetchJSON(urlSenQuery);
      const listQuery: any[] = (jsSenQuery?.members ?? jsSenQuery?.data?.members ?? jsSenQuery?.results ?? []);
      finalSenators = listQuery
        .filter(m => (memberStateCode(m) ?? state) === state)
        .filter(m => detectChamber(m) === 'senate')
        .slice(0, 2);
      usedFallbackForSen = finalSenators.length >= 1;
    }

    await clearSlot(state, 'senate');

    let seededSen = 0;
    if (finalSenators.length) {
      const rows = finalSenators.map(m => ({
        level: 'federal',
        chamber: 'senate',
        state,
        district: null,
        division_id: stateDivisionId(state), // REQUIRED by your schema
        name: memberName(m),
        office_name: 'U.S. Senator',
        email: null,
        contact_email: null,
        contact_form_url: pick(m.contactUrl, m.contactURL, m.url, m.website, m.officialWebsiteUrl) || null,
      }));
      const { error } = await supabase!.from('representatives').insert(rows);
      if (error) throw new Error(`Supabase insert (senate) failed: ${error.message}`);
      seededSen = rows.length;
    }

    // ── 2) U.S. HOUSE ───────────────────────────────────────────────────────
    let seededHouse = 0;
    let usedFallbackForHouse = false;

    if (districtRaw) {
      const district = districtRaw.toLowerCase() === 'at-large' ? 'At-Large' : districtRaw;

      // Preferred: state+district path endpoint
      let listHouse: any[] = [];
      try {
        const urlHousePath = apiURL(`member/${state}/${district}`, { currentMember: true, limit: 50 });
        const jsHousePath = await fetchJSON(urlHousePath);
        listHouse = (jsHousePath?.members ?? jsHousePath?.data?.members ?? jsHousePath?.results ?? []);
      } catch {
        // ignore and try fallback
      }

      let houseCandidates = listHouse.filter(m => detectChamber(m) === 'house');

      // Fallback: query endpoint with explicit state+district
      if (!houseCandidates.length) {
        const urlHouseQuery = apiURL('member', { state, district, currentMember: true, limit: 50 });
        const jsHouseQuery = await fetchJSON(urlHouseQuery);
        const listHQ: any[] = (jsHouseQuery?.members ?? jsHouseQuery?.data?.members ?? jsHouseQuery?.results ?? []);
        houseCandidates = listHQ.filter(m => detectChamber(m) === 'house');
        usedFallbackForHouse = houseCandidates.length > 0;
      }

      await clearSlot(state, 'house', district);

      if (houseCandidates.length) {
        const rows = houseCandidates.map(m => {
          const d = memberDistrict(m) ?? district;
          return {
            level: 'federal',
            chamber: 'house',
            state,
            district: d,
            division_id: houseDivisionId(state, d), // REQUIRED by your schema
            name: memberName(m),
            office_name: 'U.S. Representative',
            email: null,
            contact_email: null,
            contact_form_url: pick(m.contactUrl, m.contactURL, m.url, m.website, m.officialWebsiteUrl) || null,
          };
        });
        const { error } = await supabase!.from('representatives').insert(rows);
        if (error) throw new Error(`Supabase insert (house) failed: ${error.message}`);
        seededHouse = rows.length;
      }
    }

    // Privacy-safe debug (no URLs/keys)
    return {
      statusCode: 200,
      headers: H,
      body: J({
        ok: true,
        debug: {
          state,
          senateSeeded: seededSen,
          senateUsedFallback: usedFallbackForSen,
          houseDistrict: districtRaw || null,
          houseSeeded: seededHouse,
          houseUsedFallback: usedFallbackForHouse
        }
      })
    };
  } catch (e: any) {
    return { statusCode: 500, headers: H, body: J({ error: e?.message || 'Server error' }) };
  }
};

export default handler;
