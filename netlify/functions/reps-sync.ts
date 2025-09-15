// netlify/functions/reps-sync.ts
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

/**
 * Seeds federal representatives for a given state and optional House district
 * using the official Congress.gov API (api.congress.gov/v3).
 *
 * Env required:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - CONGRESS_API_KEY  (issued via api.congress.gov)
 *
 * Usage:
 *  GET /.netlify/functions/reps-sync?state=TX&house_district=21
 *
 * Notes:
 *  - Senators are seeded by state (current members only).
 *  - House member is seeded by state+district (current member only), if district is provided.
 *  - This function is idempotent: it deletes prior federal rows for the same slot
 *    (senators by state; house by state+district) before insert.
 */

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY as string;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

const headersCommon = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

type AnyObj = Record<string, any>;

function pick<T>(...vals: T[]): T | null {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return null;
}

function fullName(item: AnyObj): string {
  const n1 = pick(item.name);
  if (n1) return String(n1).trim();
  const first = pick(item.firstName, item.first_name);
  const last = pick(item.lastName, item.last_name);
  return [first, last].filter(Boolean).join(' ').trim();
}

function chamberStr(item: AnyObj): 'senate' | 'house' | null {
  const c = String(pick(item.chamber, item.chamberName, item.chamber_code, item.role) || '').toLowerCase();
  if (c.includes('sen')) return 'senate';
  if (c.includes('house') || c.includes('rep')) return 'house';
  return null;
}

function isCurrent(item: AnyObj): boolean {
  const cur = pick(item.currentMember, item.isCurrentMember, item.current);
  if (typeof cur === 'boolean') return cur;
  if (cur === 'true') return true;
  // Heuristic: missing/blank end year often implies current
  const endYear = pick(item.endYear, item.termEndYear);
  return endYear == null || String(endYear).trim() === '';
}

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url} :: ${t.slice(0, 240)}`);
  }
  return res.json();
}

// Congress.gov: list members by STATE (optionally filter later to senate)
async function fetchMembersByState(state: string): Promise<any[]> {
  const url =
    `https://api.congress.gov/v3/member/${encodeURIComponent(state)}?currentMember=true&api_key=${encodeURIComponent(CONGRESS_API_KEY)}`;
  const json = await fetchJSON(url);
  return (pick(json?.members, json?.data?.members, json?.results) as any[]) || [];
}

// Congress.gov: list member by STATE + DISTRICT (House)
async function fetchMemberByDistrict(state: string, district: string): Promise<any[]> {
  const url =
    `https://api.congress.gov/v3/member/${encodeURIComponent(state)}/${encodeURIComponent(district)}?currentMember=true&api_key=${encodeURIComponent(CONGRESS_API_KEY)}`;
  const json = await fetchJSON(url);
  return (pick(json?.members, json?.data?.members, json?.results) as any[]) || [];
}

// Idempotent cleanup: remove previous rows for the same slot, to avoid dupes.
// We do NOT rely on extra columns like civic_person_id (keeps schema-agnostic).
async function clearFederalSlot(params: { state: string; chamber: 'senate' | 'house'; district?: string | null }) {
  if (params.chamber === 'senate') {
    await supabase!.from('representatives')
      .delete()
      .eq('level', 'federal')
      .eq('chamber', 'senate')
      .eq('state', params.state);
  } else {
    await supabase!.from('representatives')
      .delete()
      .eq('level', 'federal')
      .eq('chamber', 'house')
      .eq('state', params.state)
      .eq('district', params.district ?? null);
  }
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headersCommon, body: '' };
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: headersCommon, body: JSON.stringify({ error: 'Use GET' }) };
    }
    const missing: string[] = [];
    if (!supabase) missing.push('Supabase init');
    if (!SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!CONGRESS_API_KEY) missing.push('CONGRESS_API_KEY');
    if (missing.length) {
      return { statusCode: 500, headers: headersCommon, body: JSON.stringify({ error: `Missing env: ${missing.join(', ')}` }) };
    }

    const qs = event.queryStringParameters || {};
    const state = (qs.state || '').toString().trim().toUpperCase();
    const districtRaw = (qs.house_district || '').toString().trim();
    if (!state || state.length !== 2) {
      return { statusCode: 400, headers: headersCommon, body: JSON.stringify({ error: 'Provide ?state=XX (two-letter code)' }) };
    }

    // 1) SENATORS — current members for the state, filtered to chamber=senate
    const membersByState = await fetchMembersByState(state);
    const senators = membersByState.filter((m) => isCurrent(m) && chamberStr(m) === 'senate');

    await clearFederalSlot({ state, chamber: 'senate' });

    if (senators.length) {
      const rows = senators.map((m) => ({
        level: 'federal',
        chamber: 'senate',
        state,
        district: null,
        name: fullName(m),
        office_name: 'U.S. Senator',
        email: null,
        contact_email: null,
        contact_form_url: pick(m.contactUrl, m.contactURL, m.url, m.website) || null,
      }));
      const { error } = await supabase!.from('representatives').insert(rows);
      if (error) throw new Error(`Supabase insert (senate) failed: ${error.message}`);
    }

    // 2) HOUSE — if district provided, fetch current member for that district
    let insertedHouse = 0;
    if (districtRaw) {
      const district = districtRaw.toLowerCase() === 'at-large' ? 'At-Large' : districtRaw;
      const houseMembers = await fetchMemberByDistrict(state, district);
      const houseCurrent = houseMembers.filter((m) => isCurrent(m) && chamberStr(m) === 'house');

      await clearFederalSlot({ state, chamber: 'house', district });

      if (houseCurrent.length) {
        const rows = houseCurrent.map((m) => ({
          level: 'federal',
          chamber: 'house',
          state,
          district,
          name: fullName(m),
          office_name: 'U.S. Representative',
          email: null,
          contact_email: null,
          contact_form_url: pick(m.contactUrl, m.contactURL, m.url, m.website) || null,
        }));
        const { error } = await supabase!.from('representatives').insert(rows);
        if (error) throw new Error(`Supabase insert (house) failed: ${error.message}`);
        insertedHouse = rows.length;
      }
    }

    return {
      statusCode: 200,
      headers: headersCommon,
      body: JSON.stringify({
        ok: true,
        seeded: {
          senate: senators.length,
          house: insertedHouse,
        },
        state,
        house_district: districtRaw || null,
      }),
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
