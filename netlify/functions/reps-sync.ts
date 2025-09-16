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
 *  GET /.netlify/functions/reps-sync?state=TX          // seeds both senators for TX
 *  GET /.netlify/functions/reps-sync?state=TX&house_district=21  // also seeds House TX-21
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

// The API has a few shapes; normalize where arrays might be.
const extractMembers = (obj: any): any[] => {
  if (!obj) return [];
  if (Array.isArray(obj.members)) return obj.members;
  if (obj.data && Array.isArray(obj.data.members)) return obj.data.members;
  if (Array.isArray(obj.results)) return obj.results;
  if (obj.data && Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.items)) return obj.items;
  return [];
};

const pick = (...vals: any[]) => { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return null; };

const currentTermOf = (m: any) => {
  const terms: any[] = Array.isArray(m.terms) ? m.terms : [];
  return terms.find(t => t?.current === true || t?.endYear == null) || null;
};

const memberDistrictRaw = (m: any): string | null => {
  const cur = currentTermOf(m);
  const d = pick(m.district, m.cd, m.congressionalDistrict, m.currentDistrict, cur?.district);
  return d != null ? String(d) : null; // do NOT map 0→At-Large here (we need to disambiguate)
};

const memberStateCode = (m: any): string | null => {
  const cur = currentTermOf(m);
  const s = pick(
    m.stateCode, m.state, m.stateAbbrev, m.state_abbrev, m.state_abbr,
    m.state_name, m.stateName, m.address?.state,
    cur?.stateCode, cur?.state
  );
  if (!s) return null;
  const two = String(s).trim().toUpperCase();
  // Handle cases where full name appears: e.g. "Texas" -> "TX" (only if two-letter missing)
  if (/^[A-Z]{2}$/.test(two)) return two;
  const map: Record<string, string> = {
    ALABAMA:'AL', ALASKA:'AK', ARIZONA:'AZ', ARKANSAS:'AR', CALIFORNIA:'CA', COLORADO:'CO', CONNECTICUT:'CT', DELAWARE:'DE',
    FLORIDA:'FL', GEORGIA:'GA', HAWAII:'HI', IDAHO:'ID', ILLINOIS:'IL', INDIANA:'IN', IOWA:'IA', KANSAS:'KS', KENTUCKY:'KY',
    LOUISIANA:'LA', MAINE:'ME', MARYLAND:'MD', MASSACHUSETTS:'MA', MICHIGAN:'MI', MINNESOTA:'MN', MISSISSIPPI:'MS', MISSOURI:'MO',
    MONTANA:'MT', NEBRASKA:'NE', NEVADA:'NV', NEW_HAMPSHIRE:'NH', NEW_JERSEY:'NJ', NEW_MEXICO:'NM', NEW_YORK:'NY',
    NORTH_CAROLINA:'NC', NORTH_DAKOTA:'ND', OHIO:'OH', OKLAHOMA:'OK', OREGON:'OR', PENNSYLVANIA:'PA', RHODE_ISLAND:'RI',
    SOUTH_CAROLINA:'SC', SOUTH_DAKOTA:'SD', TENNESSEE:'TN', TEXAS:'TX', UTAH:'UT', VERMONT:'VT', VIRGINIA:'VA',
    WASHINGTON:'WA', WEST_VIRGINIA:'WV', WISCONSIN:'WI', WYOMING:'WY', DISTRICT_OF_COLUMBIA:'DC', PUERTO_RICO:'PR'
  };
  const key = two.replace(/\s+/g, '_');
  return map[key] || two;
};

const isSenator = (m: any): boolean => {
  const cur = currentTermOf(m);
  const s = String(pick(cur?.chamber, m.chamber, m.chamberName, m.role, m.memberType, m.title, m.position) || '').toLowerCase();
  if (s.includes('sen')) return true;
  if (s.includes('house') || s.includes('rep')) return false;

  // If ambiguous, use district heuristics:
  // district numeric > 0  => House
  // district null/undefined => likely Senate
  // district "0" or 0 => ambiguous (could be House At-Large or Senate); don't classify here.
  const d = memberDistrictRaw(m);
  if (d == null || d === '') return true;         // no district → very likely Senate
  if (/^\d+$/.test(d) && parseInt(d, 10) > 0) return false; // numbered district → House
  return false; // "0" / "At-Large" stay false unless explicit role says Senator
};

const isRepresentative = (m: any): boolean => {
  const cur = currentTermOf(m);
  const s = String(pick(cur?.chamber, m.chamber, m.chamberName, m.role, m.memberType, m.title, m.position) || '').toLowerCase();
  if (s.includes('house') || s.includes('rep')) return true;
  if (s.includes('sen')) return false;

  const d = memberDistrictRaw(m);
  if (/^\d+$/.test(String(d || '')).trim() && parseInt(String(d), 10) > 0) return true; // numbered districts are House
  // treat 0/At-Large as House only when we explicitly queried by state+district (see below)
  return false;
};

const memberName = (m: any): string =>
  (pick(m.name, `${pick(m.firstName, m.first_name, '')} ${pick(m.lastName, m.last_name, '')}`) || '').toString().trim();

const memberContactURL = (m: any): string | null =>
  (pick(m.contactUrl, m.contactURL, m.url, m.website, m.officialWebsiteUrl) as string) || null;

// ── OCD division ID (NOT NULL in your schema) ─────────────────────────────────
const stateDivisionId = (state: string) => `ocd-division/country:us/state:${state.toLowerCase()}`;
const normalizeCd = (district: string) => {
  const s = String(district).trim().toLowerCase();
  if (s === 'at-large' || s === 'at large' || s === 'atlarge' || s === '0') return '1';
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
    const districtRaw = (qs.house_district != null && String(qs.house_district).trim() !== '')
      ? String(qs.house_district).trim()
      : null;

    if (!/^[A-Z]{2}$/.test(state)) {
      return { statusCode: 400, headers: H, body: J({ error: 'Provide ?state=XX (two-letter code)' }) };
    }

    // ── 1) U.S. SENATORS ────────────────────────────────────────────────────
    // 1a. Preferred: state-path endpoint
    const urlSenPath = apiURL(`member/${state}`, { currentMember: true, limit: 250 });
    let jsSenPath: any = null;
    let pathSenators: any[] = [];
    try {
      jsSenPath = await fetchJSON(urlSenPath);
      const listPath = extractMembers(jsSenPath);
      pathSenators = listPath.filter(m => (memberStateCode(m) ?? state) === state).filter(isSenator);
    } catch {
      // ignore; will use fallback
    }

    // 1b. Fallback: explicit chamber query + filter by state; page if needed
    let finalSenators = pathSenators;
    let usedFallbackForSen = false;

    if (finalSenators.length < 2) {
      let collected: any[] = [];
      let offset = 0;
      const limit = 250;
      for (let page = 0; page < 4; page++) { // hard cap to avoid runaway; 1000 records max
        const url = apiURL('member', { chamber: 'Senate', currentMember: true, limit, offset });
        const js = await fetchJSON(url);
        const rows = extractMembers(js);
        if (!rows.length) break;
        collected = collected.concat(rows);
        if (rows.length < limit) break;
        offset += limit;
      }
      const byState = collected.filter(m => (memberStateCode(m) ?? state) === state);
      finalSenators = byState.length ? byState : finalSenators;
      usedFallbackForSen = finalSenators.length > 0 && pathSenators.length === 0;
    }

    // only clear if we have something to write (avoids wiping on transient 0-results)
    let senateSeeded = 0;
    if (finalSenators.length) {
      await clearSlot(state, 'senate');
      const rows = finalSenators.slice(0, 2).map(m => ({
        level: 'federal',
        chamber: 'senate',
        state,
        district: null,
        division_id: stateDivisionId(state), // REQUIRED by your schema
        name: memberName(m),
        office_name: 'U.S. Senator',
        email: null,
        contact_email: null,
        contact_form_url: memberContactURL(m),
      }));
      const { error } = await supabase!.from('representatives').insert(rows);
      if (error) throw new Error(`Supabase insert (senate) failed: ${error.message}`);
      senateSeeded = rows.length;
    }

    // ── 2) U.S. HOUSE (ONLY when district explicitly provided) ───────────────
    let houseSeeded = 0;
    let usedFallbackForHouse = false;

    if (districtRaw) {
      // Normalize for Congress.gov path; both "21" and "At-Large" acceptable
      const districtPath = (/^\d+$/.test(districtRaw) ? String(parseInt(districtRaw, 10)) : districtRaw);

      // 2a. Preferred: state+district path endpoint
      let houseList: any[] = [];
      try {
        const urlHousePath = apiURL(`member/${state}/${districtPath}`, { currentMember: true, limit: 50 });
        const jsHousePath = await fetchJSON(urlHousePath);
        const listHP = extractMembers(jsHousePath);
        houseList = listHP.filter(isRepresentative);
      } catch {
        // ignore; fallback next
      }

      // 2b. Fallback: query endpoint with explicit state+district
      let houseCandidates = houseList;
      if (!houseCandidates.length) {
        const urlHouseQuery = apiURL('member', { state, district: districtPath, currentMember: true, limit: 50 });
        const jsHouseQuery = await fetchJSON(urlHouseQuery);
        const listHQ = extractMembers(jsHouseQuery);
        // When we explicitly request a district, a "0"/"At-Large" is definitely House.
        houseCandidates = listHQ.filter(m => {
          if (isRepresentative(m)) return true;
          const d = memberDistrictRaw(m);
          if (d === '0' || String(d).toLowerCase().includes('at-large')) return true;
          return false;
        });
        usedFallbackForHouse = houseCandidates.length > 0 && !houseList.length;
      }

      if (houseCandidates.length) {
        await clearSlot(state, 'house', districtPath);
        const rows = houseCandidates.map(m => {
          const d = String(memberDistrictRaw(m) ?? districtPath);
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
            contact_form_url: memberContactURL(m),
          };
        });
        const { error } = await supabase!.from('representatives').insert(rows);
        if (error) throw new Error(`Supabase insert (house) failed: ${error.message}`);
        houseSeeded = rows.length;
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
          senateSeeded,
          senateUsedFallback: usedFallbackForSen,
          houseDistrict: districtRaw || null,
          houseSeeded,
          houseUsedFallback: usedFallbackForHouse
        }
      })
    };
  } catch (e: any) {
    return { statusCode: 500, headers: H, body: J({ error: e?.message || 'Server error' }) };
  }
};

export default handler;
