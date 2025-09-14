// netlify/functions/state-reps-sync.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

// ── Required env ──────────────────────────────────────────────────────────────
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - OPENSTATES_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string
const OPENSTATES_API_KEY = process.env.OPENSTATES_API_KEY as string

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

const missingEnv = () => {
  const miss: string[] = []
  if (!SUPABASE_URL) miss.push('SUPABASE_URL')
  if (!SUPABASE_SERVICE_ROLE_KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!OPENSTATES_API_KEY) miss.push('OPENSTATES_API_KEY')
  return miss
}

// ── OpenStates v3 basics ──────────────────────────────────────────────────────
// Root: https://v3.openstates.org/  (API key via X-API-KEY or ?apikey=)
// Methods we use: /people with params: jurisdiction, chamber, district
const OPENSTATES_ROOT = 'https://v3.openstates.org'

const STATE_CODE_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico'
}

type OpenStatesPerson = {
  id?: string
  name?: string
  party?: string | null
  image?: string | null
  email?: string | null
  links?: Array<{ url?: string | null }> | null
  offices?: Array<{ classification?: string | null; address?: string | null; voice?: string | null; email?: string | null }> | null
  current_role?: { chamber?: 'upper' | 'lower'; district?: string | null } | null
}

const osFetch = async (path: string, params: Record<string, string>) => {
  const u = new URL(`${OPENSTATES_ROOT}${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  // auth via header (recommended)
  const res = await fetch(u.toString(), { headers: { 'X-API-KEY': OPENSTATES_API_KEY } })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`OpenStates error ${res.status}: ${t || u.toString()}`)
  }
  return res.json()
}

const officeLabel = (ch: 'upper' | 'lower') => (ch === 'upper' ? 'State Senator' : 'State Representative')
const toChamber = (ch: 'upper' | 'lower'): 'senate' | 'house' => (ch === 'upper' ? 'senate' : 'house')

const ocdDivisionForStateDistrict = (state2: string, ch: 'upper' | 'lower', district: string | null) => {
  const s = (state2 || '').toLowerCase()
  if (!district) return null
  const kind = ch === 'upper' ? 'sldu' : 'sldl'
  return `ocd-division/country:us/state:${s}/${kind}:${district.toLowerCase()}`
}

const firstNonEmpty = (...vals: Array<string | null | undefined>) => vals.find(v => !!(v && String(v).trim())) || null

const toRow = (
  p: OpenStatesPerson,
  state2: string,
  ch: 'upper' | 'lower',
  district: string | null
) => {
  const party = p.party || null
  const photo_url = p.image || null
  const website = p.links?.[0]?.url || null
  const office_email = firstNonEmpty(p.email, p.offices?.find(o => o?.email)?.email)
  const phone = p.offices?.find(o => o?.voice)?.voice || null

  return {
    // ids
    civic_person_id: p.id || null,            // use OpenStates person id for stable upsert
    source: 'openstates-v3',

    // person + office
    name: p.name || null,
    party,
    photo_url,

    office_name: officeLabel(ch),
    level: 'state',
    chamber: toChamber(ch),
    state: state2.toUpperCase(),
    district: district,

    // contacts
    email: null,                 // generally unused for state; prefer contact_email
    contact_email: office_email,
    contact_form_url: null,      // could be filled later from official site
    phone,
    website,

    // lifecycle
    term_end: null,
    active: true,
    division_id: ocdDivisionForStateDistrict(state2, ch, district),
    last_synced: new Date().toISOString()
  }
}

const upsertReps = async (rows: any[]) => {
  if (!supabase) throw new Error('Supabase not initialized')
  // Upsert by civic_person_id to remain stable across re-syncs
  const { error } = await supabase
    .from('representatives')
    .upsert(rows, { onConflict: 'civic_person_id' })
  if (error) throw new Error(error.message)
}

const fetchPeople = async (jurisdiction: string, ch: 'upper' | 'lower', district: string) => {
  // people?jurisdiction=Texas&chamber=upper&district=10
  const j = await osFetch('/people', {
    jurisdiction,
    chamber: ch,
    district
  })
  // v3 returns { results: [...], pagination: {...} }
  const arr: OpenStatesPerson[] = Array.isArray(j?.results) ? j.results : []
  return arr
}

export const handler: Handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }

  const miss = missingEnv()
  if (miss.length) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: `Missing env: ${miss.join(', ')}` }) }
  }
  if (!supabase) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not initialized' }) }
  }

  const qs = event.queryStringParameters || {}
  const stateCode = (qs.state || '').toString().trim().toUpperCase()
  const sd = (qs.sd || '').toString().trim() || null   // state senate district
  const hd = (qs.hd || '').toString().trim() || null   // state house/assembly district

  if (!stateCode || stateCode.length !== 2) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provide ?state=XX (two-letter code)' }) }
  }
  const jurisdiction = STATE_CODE_TO_NAME[stateCode]
  if (!jurisdiction) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unsupported state code: ${stateCode}` }) }
  }

  try {
    const rows: any[] = []

    // Upper chamber (State Senate)
    if (sd) {
      const people = await fetchPeople(jurisdiction, 'upper', sd)
      for (const p of people) rows.push(toRow(p, stateCode, 'upper', sd))
    }

    // Lower chamber (State House/Assembly)
    if (hd) {
      const people = await fetchPeople(jurisdiction, 'lower', hd)
      for (const p of people) rows.push(toRow(p, stateCode, 'lower', hd))
    }

    if (rows.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, upserted: 0, state: stateCode, sd, hd, message: 'No results from OpenStates for provided districts.' }) }
    }

    await upsertReps(rows)

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, upserted: rows.length, state: stateCode, sd, hd }) }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'Server error' }) }
  }
}

export default handler
