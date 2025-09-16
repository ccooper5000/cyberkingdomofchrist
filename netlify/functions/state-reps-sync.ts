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

/** Build the people search URL. We include BOTH jurisdiction (full state name) and state code. */
const apiURL = (params: Record<string,string|number|undefined>, state: string) => {
  const u = new URL('https://v3.openstates.org/people');
  for (const [k,v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  // Preferred search hints (both are accepted by OpenStates)
  const jurisdiction = stateName(state);
  u.searchParams.set('jurisdiction', jurisdiction);
  u.searchParams.set('state', state);
  // keep a small page size; we expect a single match
  u.searchParams.set('per_page', '5');
  // still include apikey as a query param (harmless redundancy)
  u.searchParams.set('apikey', OPENSTATES_API_KEY);
  return u.toString();
};

/** fetch with timeout + retries; include X-API-KEY + UA headers */
async function fetchJSON(url: string, retry = 2): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000); // 10s
  try {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CKOC/1.0 (+https://cyberkingdomofchrist.org)',
        'X-API-KEY': OPENSTATES_API_KEY,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} :: ${t.slice(0,240)}`);
    }
    return r.json();
  } catch (err: any) {
    clearTimeout(timeout);
    const msg = String(err?.message || err || '');
    // Retry on timeouts or transient upstream failures
    if (retry > 0 && (/aborted|timeout|ETIMEDOUT|ECONNRESET|fetch failed|502|503|504/i.test(msg))) {
      await new Promise(res => setTimeout(res, 350));
      return fetchJSON(url, retry - 1);
    }
    throw new Error(`OpenStates fetch failed: ${msg}`);
  }
}

const pick = (...vals: any[]) => { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return null; };
const fullName = (p: any) => String(p.name || `${pick(p.given_name, p.givenName, '')} ${pick(p.family_name, p.familyName, '')}` || '').trim();

const arr = (x: any) => (Array.isArray(x) ? x : []);
const extractPeople = (js: any): any[] =>
  arr(js?.results) || arr(js?.data) || arr(js?.people) || arr(js?.items) || [];

/** Extract best-known email from OpenStates person object */
const extractEmail = (person: any): string | null => {
  const direct = pick(person?.email, person?.primary_email);
  if (direct) return String(direct);
  for (const off of arr(person?.offices)) if (off?.email) return String(off.email);
  for (const cd of arr(person?.contact_details)) {
    const type = String(cd?.type || '').toLowerCase();
    if (type === 'email' && cd?.value) return String(cd.value);
  }
  return null;
};

/** Normalize a Twitter handle: strip URL/@ and keep [A-Za-z0-9_]{1,15} */
const normalizeTwitterHandle = (val: string): string | null => {
  if (!val) return null;
  let v = String(val).trim();
  if (v.startsWith('@')) v = v.slice(1);
  try {
    if (/^https?:\/\//i.test(v)) {
      const u = new URL(v);
      if (u.hostname.replace(/^www\./,'').toLowerCase() === 'twitter.com' || u.hostname.toLowerCase() === 'x.com') {
        const seg = u.pathname.split('/').filter(Boolean)[0] || '';
        v = seg.startsWith('@') ? seg.slice(1) : seg;
      }
    }
  } catch { /* ignore URL parse */ }
  v = v.replace(/[^A-Za-z0-9_]/g, '');
  if (!v) return null;
  return v.slice(0, 15);
};

/** Extract Twitter handle from various OpenStates shapes */
const extractTwitterHandle = (person: any): string | null => {
  const idsTw = pick(person?.ids?.twitter, person?.twitter, person?.social_media?.twitter);
  const normIds = idsTw ? normalizeTwitterHandle(String(idsTw)) : null;
  if (normIds) return normIds;
  for (const cd of arr(person?.contact_details)) {
    const type = String(cd?.type || '').toLowerCase();
    if (type === 'twitter' && cd?.value) {
      const norm = normalizeTwitterHandle(String(cd.value));
      if (norm) return norm;
    }
  }
  for (const link of arr(person?.links)) {
    const url = String(link?.url || '');
    if (/twitter\.com|x\.com/i.test(url)) {
      const norm = normalizeTwitterHandle(url);
      if (norm) return norm;
    }
  }
  return null;
};

/** Normalize a Facebook page URL; if given a slug/ID, prefix with https://www.facebook.com/ */
const normalizeFacebookUrl = (val: string): string | null => {
  if (!val) return null;
  let v = String(val).trim();
  if (!/^https?:\/\//i.test(v)) v = `https://www.facebook.com/${v.replace(/^@/, '')}`;
  try {
    const u = new URL(v);
    if (!/facebook\.com$/i.test(u.hostname.replace(/^www\./,''))) return null;
    u.search = ''; u.hash = '';
    return u.toString();
  } catch { return null; }
};

/** Extract Facebook page URL from various OpenStates shapes */
const extractFacebookUrl = (person: any): string | null => {
  const idsFb = pick(person?.ids?.facebook, person?.facebook, person?.social_media?.facebook);
  const normIds = idsFb ? normalizeFacebookUrl(String(idsFb)) : null;
  if (normIds) return normIds;
  for (const cd of arr(person?.contact_details)) {
    const type = String(cd?.type || '').toLowerCase();
    if (type === 'facebook' && cd?.value) {
      const norm = normalizeFacebookUrl(String(cd.value));
      if (norm) return norm;
    }
  }
  for (const link of arr(person?.links)) {
    const url = String(link?.url || '');
    if (/facebook\.com/i.test(url)) {
      const norm = normalizeFacebookUrl(url);
      if (norm) return norm;
    }
  }
  return null;
};

/** Build common row fields from an OpenStates person */
const buildRepRow = (opts: {
  person: any;
  level: 'state';
  chamber: 'senate' | 'house';
  state: string;
  district: string;
  division_id: string;
  office_name: string;
}) => {
  const { person, level, chamber, state, district, division_id, office_name } = opts;
  const email = extractEmail(person);
  const twitter_handle = extractTwitterHandle(person);
  const facebook_page_url = extractFacebookUrl(person);

  return {
    level,
    chamber,
    state,
    district,
    division_id,
    name: fullName(person),
    office_name,
    email: email ?? null,
    contact_email: email ?? null,
    twitter_handle: twitter_handle ?? null,
    facebook_page_url: facebook_page_url ?? null,
    contact_form_url: (person?.url || person?.website || (arr(person?.links)[0]?.url as string) || null),
  };
};

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

    const doUpper = Boolean(sd);
    const doLower = Boolean(hd);
    if (!doUpper && !doLower) {
      return { statusCode: 400, headers: H, body: J({ error: 'Provide sd and/or hd' }) };
    }

    // ── 1) State Senator (upper / SD) ───────────────────────────────────────
    let seededSD = 0;
    if (doUpper) {
      const urlUpper = apiURL({ chamber: 'upper', district: sd! }, state);
      const jsU = await fetchJSON(urlUpper);
      const peopleU = extractPeople(jsU);
      const personU = peopleU[0]; // expect exactly one

      if (personU) {
        const row = buildRepRow({
          person: personU,
          level: 'state',
          chamber: 'senate',
          state,
          district: sd!,
          division_id: slduDiv(state, sd!),
          office_name: 'State Senator',
        });
        await clearSlot(state, 'senate', sd!);
        await insertOne(row);
        seededSD = 1;
      }
    }

    // ── 2) State Representative (lower / HD) ────────────────────────────────
    let seededHD = 0;
    if (doLower) {
      const urlLower = apiURL({ chamber: 'lower', district: hd! }, state);
      const jsL = await fetchJSON(urlLower);
      const peopleL = extractPeople(jsL);
      const personL = peopleL[0];

      if (personL) {
        const row = buildRepRow({
          person: personL,
          level: 'state',
          chamber: 'house',
          state,
          district: hd!,
          division_id: sldlDiv(state, hd!),
          office_name: 'State Representative',
        });
        await clearSlot(state, 'house', hd!);
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
