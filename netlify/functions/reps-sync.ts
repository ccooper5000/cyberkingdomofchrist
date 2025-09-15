// netlify/functions/reps-sync.ts
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// ── Env ───────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY as string;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

const J = (o: any) => JSON.stringify(o);

// ── Helpers ──────────────────────────────────────────────────────────────────
const headersCommon = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama:'AL', Alaska:'AK', Arizona:'AZ', Arkansas:'AR', California:'CA', Colorado:'CO', Connecticut:'CT',
  Delaware:'DE', 'District of Columbia':'DC', Florida:'FL', Georgia:'GA', Hawaii:'HI', Idaho:'ID', Illinois:'IL',
  Indiana:'IN', Iowa:'IA', Kansas:'KS', Kentucky:'KY', Louisiana:'LA', Maine:'ME', Maryland:'MD', Massachusetts:'MA',
  Michigan:'MI', Minnesota:'MN', Mississippi:'MS', Missouri:'MO', Montana:'MT', Nebraska:'NE', Nevada:'NV',
  'New Hampshire':'NH', 'New Jersey':'NJ', 'New Mexico':'NM', 'New York':'NY', 'North Carolina':'NC',
  'North Dakota':'ND', Ohio:'OH', Oklahoma:'OK', Oregon:'OR', Pennsylvania:'PA', 'Rhode Island':'RI',
  'South Carolina':'SC', 'South Dakota':'SD', Tennessee:'TN', Texas:'TX', Utah:'UT', Vermont:'VT',
  Virginia:'VA', Washington:'WA', 'West Virginia':'WV', Wisconsin:'WI', Wyoming:'WY', 'Puerto Rico':'PR'
};

const toUSPS = (s: string) => {
  if (!s) return null;
  const t = s.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_NAME_TO_CODE[t] || null;
};

const qurl = (path: string, params: Record<string,string|number|boolean|undefined>) => {
  const u = new URL(`https://api.congress.gov/v3/${path}`);
  for (const [k,v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  u.searchParams.set('api_key', CONGRESS_API_KEY);
  u.searchParams.set('format', 'json');
  return u.toString();
};

const jsonFetch = async (url: string) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} for ${url} :: ${t.slice(0,240)}`);
  }
  return r.json();
};

const pick = (...vals: any[]) => {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return null;
};

const memberName = (m: any): string => {
  return (pick(m.name, `${pick(m.firstName, m.first_name, '')} ${pick(m.lastName, m.last_name, '')}`) || '')
    .toString().trim();
};

// Try many possible fields for “district”
const memberDistrict = (m: any): string | null => {
  const terms: any[] = Array.isArray(m.terms) ? m.terms : [];
  const currentTerm = terms.find(t => (t.current === true) || (t.endYear == null));
  const d = pick(
    m.district,
    m.cd,
    m.congressionalDistrict,
    m.currentDistrict,
    currentTerm?.district
  );
  if (d === 0 || d === '0') return 'At-Large';
  return d != null ? String(d) : null;
};

const detectChamber = (m: any): 'senate'|'house'|null => {
  const terms: any[] = Array.isArray(m.terms) ? m.terms : [];
  const currentTerm = terms.find(t => (t.current === true) || (t.endYear == null));
  const explicit = String(pick(
    currentTerm?.chamber,
    m.chamber, m.chamberName, m.role
  ) || '').toLowerCase();
  if (explicit.includes('sen')) return 'senate';
  if (explicit.includes('house') || explicit.includes('rep')) return 'house';
  // Fallback: no district => senator; district present => house
  const d = memberDistrict(m);
  if (d == null) return 'senate';
  return 'house';
};

// ----- division_id helpers (OCD-style) -----
const stateDivisionId = (state: string) =>
  `ocd-division/country:us/state:${state.toLowerCase()}`;

const normalizeCd = (district: string) => {
  const s = String(district).trim().toLowerCase();
  if (s === 'at-large' || s === 'at large' || s === 'atlarge') return '1';
  const m = s.match(/\d+/);
  return m ? m[0] : '1';
};

const houseDivisionId = (state: string, district: string) =>
  `ocd-division/country:us/state:${state.toLowerCase()}/cd:${normalizeCd(district)}`;

// Idempotent cleanup (by slot), then insert
async function clearFederalSlot(state: string, chamber: 'senate'|'house', district?: string | null) {
  if (chamber === 'senate') {
    await supabase!.from('representatives')
      .delete()
      .eq('level','federal')
      .eq('chamber','senate')
      .eq('state', state);
  } else {
    await supabase!.from('representatives')
      .delete()
      .eq('level','federal')
      .eq('chamber','house')
      .eq('state', state)
      .eq('district', district ?? null);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headersCommon, body: '' };
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: headersCommon, body: J({ error: 'Use GET' }) };
    }
    const miss: string[] = [];
    if (!supabase) miss.push('Supabase init');
    if (!SUPABASE_URL) miss.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!CONGRESS_API_KEY) miss.push('CONGRESS_API_KEY');
    if (miss.length) {
      return { statusCode: 500, headers: headersCommon, body: J({ error: `Missing env: ${miss.join(', ')}` }) };
    }

    const qs = event.queryStringParameters || {};
    const stateRaw = (qs.state ?? '').toString();
    const state = toUSPS(stateRaw);
    const districtRaw = (qs.house_district ?? '').toString().trim();
    if (!state) {
      return { statusCode: 400, headers: headersCommon, body: J({ error: 'Provide ?state=TX (or full state name)' }) };
    }

    // 1) Senators — query-style endpoint: member?state=XX&currentMember=true
    const urlSen = qurl('member', { state, currentMember: true, limit: 250 });
    const jsSen = await jsonFetch(urlSen);
    const membersAll: any[] = (jsSen?.members ?? jsSen?.data?.members ?? jsSen?.results ?? []);
    const senators = membersAll.filter(m => detectChamber(m) === 'senate');

    await clearFederalSlot(state, 'senate');

    let seededSen = 0;
    if (senators.length) {
      const rows = senators.map(m => ({
        level: 'federal',
        chamber: 'senate',
        state,
        district: null,
        division_id: stateDivisionId(state),            // ← REQUIRED (NOT NULL) ✅
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

    // 2) House — if district provided, query: member?state=XX&district=YY&currentMember=true
    let seededHouse = 0;
    let houseCandidates: any[] = [];
    if (districtRaw) {
      const district = districtRaw.toLowerCase() === 'at-large' ? 'At-Large' : districtRaw;
      const urlHouse = qurl('member', { state, district, currentMember: true, limit: 50 });
      const jsHouse = await jsonFetch(urlHouse);
      const membersHouse: any[] = (jsHouse?.members ?? jsHouse?.data?.members ?? jsHouse?.results ?? []);
      houseCandidates = membersHouse.filter(m => detectChamber(m) === 'house');
      await clearFederalSlot(state, 'house', district);
      if (houseCandidates.length) {
        const rows = houseCandidates.map(m => ({
          level: 'federal',
          chamber: 'house',
          state,
          district: memberDistrict(m) ?? district,
          division_id: houseDivisionId(state, memberDistrict(m) ?? district), // ← REQUIRED (NOT NULL) ✅
          name: memberName(m),
          office_name: 'U.S. Representative',
          email: null,
          contact_email: null,
          contact_form_url: pick(m.contactUrl, m.contactURL, m.url, m.website, m.officialWebsiteUrl) || null,
        }));
        const { error } = await supabase!.from('representatives').insert(rows);
        if (error) throw new Error(`Supabase insert (house) failed: ${error.message}`);
        seededHouse = rows.length;
      }
    }

    // Debug payload to make Network → Response useful
    const debug = {
      state,
      senQuery: urlSen,
      totalMembersFetched: membersAll.length,
      senatorsDetected: senators.length,
      houseDistrict: districtRaw || null,
      houseCandidatesDetected: houseCandidates.length,
      inserted: { senate: seededSen, house: seededHouse }
    };

    return { statusCode: 200, headers: headersCommon, body: J({ ok: true, debug }) };
  } catch (e: any) {
    return { statusCode: 500, headers: headersCommon, body: J({ error: e?.message || 'Server error' }) };
  }
};

export default handler;
