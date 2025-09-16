// netlify/functions/state-reps-sync.ts
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

/**
 * Seeds state-level legislators (one State Senator by SD, one State Representative by HD)
 * via the OpenStates API.
 *
 * Env:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - OPENSTATES_API_KEY
 *
 * Usage:
 *  GET /.netlify/functions/state-reps-sync?state=TX&sd=26&hd=120
 *     state: 2-letter USPS code
 *     sd: state senate district (upper)  e.g., "26"
 *     hd: state house district (lower)   e.g., "120"
 */

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const OPENSTATES_API_KEY = process.env.OPENSTATES_API_KEY as string;

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

const STATE_CODE_TO_NAME: Record<string, string> = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut',
  DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois',
  IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts',
  MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada',
  NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina',
  ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island',
  SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', PR:'Puerto Rico'
};

const stateName = (code: string) => STATE_CODE_TO_NAME[code] || code;
const stateDiv = (state: string) => `ocd-division/country:us/state:${state.toLowerCase()}`;
const slduDiv = (state: string, sd: string) => `${stateDiv(state)}/sldu:${String(sd).trim()}`;
const sldlDiv = (state: string, hd: string) => `${stateDiv(state)}/sldl:${String(hd).trim()}`;

const apiURL = (params: Record<string,string|number|undefined>) => {
  const u = new URL('https://v3.openstates.org/people');
  for (const [k,v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  u.searchParams.set('apikey', OPENSTATES_API_KEY);
  // We ask for small page sizes; there should be only 1 match for a single district
  u.searchParams.set('per_page', '5');
  return u.toString();
};

const fetchJSON = async (url: string) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} :: ${t.slice(0,240)}`);
  }
  return r.json();
};

const pick = (...vals: any[]) => { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return null; };
const fullName = (p: any) => String(p.name || `${pick(p.given_name, p.givenName, '')} ${pick(p.family_name, p.familyName, '')}` || '').trim();

async function clearSlot(state: string, chamber: 'senate'|'house', district: string) {
  await supabase!.from('representatives')
    .delete()
    .eq('level', 'state')
    .eq('state', state)
    .eq('chamber', chamber)
    .eq('district', district);
}

async function insertOne(row: any) {
  const { error } = await supabase!.from('representatives').insert([row]);
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: H, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: H, body: J({ error: 'Use GET' }) };

    const miss: string[] = [];
    if (!supabase) miss.push('Supabase init');
    if (!SUPABASE_URL) miss.push('SUPABASE_URL');
    if (!SUPABASE_SERVICE_ROLE_KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!OPENSTATES_API_KEY) miss.push('OPENSTATES_API_KEY');
    if (miss.length) return { statusCode: 500, headers: H, body: J({ error: `Missing env: ${miss.join(', ')}` }) };

    const qs = event.queryStringParameters || {};
    const state = String(qs.state || '').toUpperCase();
    const sd = String(qs.sd || '').trim() || undefined;
    const hd = String(qs.hd || '').trim() || undefined;

    if (!/^[A-Z]{2}$/.test(state)) {
      return { statusCode: 400, headers: H, body: J({ error: 'Provide ?state=XX (two-letter code)' }) };
    }

    const jurisdiction = stateName(state);

    // ── 1) State Senator (upper / SD) ───────────────────────────────────────
    let seededSD = 0;
    if (sd) {
      // OpenStates people search for upper chamber district
      const urlUpper = apiURL({ jurisdiction, chamber: 'upper', district: sd });
      const jsU = await fetchJSON(urlUpper);
      const peopleU: any[] = (jsU?.results ?? jsU?.data ?? jsU?.people ?? jsU?.items ?? []);
      const personU = peopleU[0]; // there should be exactly one
      await clearSlot(state, 'senate', sd);
      if (personU) {
        const row = {
          level: 'state',
          chamber: 'senate',
          state,
          district: sd,
          division_id: slduDiv(state, sd),
          name: fullName(personU),
          office_name: 'State Senator',
          email: pick(personU.email, personU.primary_email) || null,
          contact_email: null,
          contact_form_url: pick(personU.url, personU.website, personU.links?.[0]?.url) || null,
        };
        await insertOne(row);
        seededSD = 1;
      }
    }

    // ── 2) State Representative (lower / HD) ────────────────────────────────
    let seededHD = 0;
    if (hd) {
      const urlLower = apiURL({ jurisdiction, chamber: 'lower', district: hd });
      const jsL = await fetchJSON(urlLower);
      const peopleL: any[] = (jsL?.results ?? jsL?.data ?? jsL?.people ?? jsL?.items ?? []);
      const personL = peopleL[0];
      await clearSlot(state, 'house', hd);
      if (personL) {
        const row = {
          level: 'state',
          chamber: 'house',
          state,
          district: hd,
          division_id: sldlDiv(state, hd),
          name: fullName(personL),
          office_name: 'State Representative',
          email: pick(personL.email, personL.primary_email) || null,
          contact_email: null,
          contact_form_url: pick(personL.url, personL.website, personL.links?.[0]?.url) || null,
        };
        await insertOne(row);
        seededHD = 1;
      }
    }

    return { statusCode: 200, headers: H, body: J({ ok: true, seeded: { senate: seededSD, house: seededHD } }) };
  } catch (e: any) {
    return { statusCode: 500, headers: H, body: J({ error: e?.message || 'Server error' }) };
  }
};

export default handler;
