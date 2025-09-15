// netlify/functions/reps-sync.ts
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// ---- Required env ----
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - (one of) CONGRESS_API_KEY or PROPUBLICA_API_KEY  (ProPublica Congress API)
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const CONGRESS_API_KEY =
  (process.env.CONGRESS_API_KEY as string) || (process.env.PROPUBLICA_API_KEY as string) || '';

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

const headersCommon = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

const PP_ROOT = 'https://api.propublica.org/congress/v1';

type PPCurrentMember = {
  id: string; // bioguide_id
  first_name: string;
  last_name: string;
  district?: string | null; // House only
  api_uri: string; // detail URL
  party?: string | null;
};

// House/Senate detail payload (for contact_form/url)
type PPDetail = {
  results?: Array<{
    url?: string | null;
    contact_form?: string | null;
  }>;
};

function stateToDivisionId(state: string): string {
  return `ocd-division/country:us/state:${state.toLowerCase()}`;
}

function houseDivisionId(state: string, district: string): string {
  const d = district.toLowerCase() === 'at-large' ? '1' : district;
  return `ocd-division/country:us/state:${state.toLowerCase()}/cd:${d}`;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'X-API-Key': CONGRESS_API_KEY } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} fetching ${url}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

async function getSenators(state: string): Promise<PPCurrentMember[]> {
  // /members/senate/{state}/current.json
  const url = `${PP_ROOT}/members/senate/${state}/current.json`;
  const json: any = await fetchJSON<any>(url);
  return (json?.results ?? []) as PPCurrentMember[];
}

async function getHouseMember(state: string, district: string): Promise<PPCurrentMember[]> {
  // /members/house/{state}/{district}/current.json
  const url = `${PP_ROOT}/members/house/${state}/${district}/current.json`;
  const json: any = await fetchJSON<any>(url);
  return (json?.results ?? []) as PPCurrentMember[];
}

async function getMemberDetail(apiUri: string): Promise<PPDetail> {
  return fetchJSON<PPDetail>(apiUri);
}

async function upsertFederalRows(rows: any[]) {
  if (!rows.length) return;

  // Avoid duplicates without relying on a unique index: delete-by-civic_person_id, then insert.
  for (const r of rows) {
    const civicId = r.civic_person_id as string;
    if (civicId) {
      await supabase!.from('representatives').delete().eq('civic_person_id', civicId);
    }
  }
  const { error } = await supabase!.from('representatives').insert(rows);
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headersCommon, body: '' };
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: headersCommon, body: JSON.stringify({ error: 'Use GET' }) };
    }

    // Env checks
    const missing: string[] = [];
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!CONGRESS_API_KEY) missing.push('CONGRESS_API_KEY (or PROPUBLICA_API_KEY)');
    if (missing.length) {
      return {
        statusCode: 500,
        headers: headersCommon,
        body: JSON.stringify({ error: `Missing env: ${missing.join(', ')}` }),
      };
    }
    if (!supabase) {
      return { statusCode: 500, headers: headersCommon, body: JSON.stringify({ error: 'Supabase not initialized' }) };
    }

    const qs = event.queryStringParameters || {};
    const state = (qs.state || '').toString().trim().toUpperCase();
    const houseDistrict = (qs.house_district || '').toString().trim();

    if (!state || state.length !== 2) {
      return {
        statusCode: 400,
        headers: headersCommon,
        body: JSON.stringify({ error: 'Provide ?state=XX (two-letter code)' }),
      };
    }

    // 1) Senators (always)
    const senators = await getSenators(state);

    // 2) House (only if district provided)
    let house: PPCurrentMember[] = [];
    if (houseDistrict) {
      house = await getHouseMember(state, houseDistrict);
    }

    // Fetch details (contact forms/URLs) — small N (<=3)
    const all = [...senators, ...house];
    const detailsById = new Map<string, PPDetail>();
    await Promise.all(
      all.map(async (m) => {
        try {
          const d = await getMemberDetail(m.api_uri);
          detailsById.set(m.id, d);
        } catch {
          // ignore detail failures; we'll still insert base row
        }
      })
    );

    const rows: any[] = [];

    // Map senators
    for (const m of senators) {
      const det = detailsById.get(m.id)?.results?.[0] || {};
      rows.push({
        // identification
        civic_person_id: m.id, // bioguide id
        level: 'federal',
        chamber: 'senate',
        state,
        district: null,
        division_id: stateToDivisionId(state),
        // display/contact
        name: `${m.first_name} ${m.last_name}`.trim(),
        office_name: 'U.S. Senator',
        email: null,
        contact_email: null,
        contact_form_url: det.contact_form || det.url || null,
        party: m.party || null,
        source: 'propublica',
      });
    }

    // Map house member (if any)
    for (const m of house) {
      const det = detailsById.get(m.id)?.results?.[0] || {};
      const d = m.district || houseDistrict || 'At-Large';
      rows.push({
        civic_person_id: m.id,
        level: 'federal',
        chamber: 'house',
        state,
        district: d,
        division_id: houseDivisionId(state, d),
        name: `${m.first_name} ${m.last_name}`.trim(),
        office_name: 'U.S. Representative',
        email: null,
        contact_email: null,
        contact_form_url: det.contact_form || det.url || null,
        party: m.party || null,
        source: 'propublica',
      });
    }

    await upsertFederalRows(rows);

    return {
      statusCode: 200,
      headers: headersCommon,
      body: JSON.stringify({ ok: true, upserted: rows.length, state, house_district: houseDistrict || null }),
    };
  } catch (e: any) {
    return {
      statusCode: 500,
      headers: headersCommon,
      body: JSON.stringify({ error: e?.message || 'Server error' }),
    };
  }
};

export default handler;
