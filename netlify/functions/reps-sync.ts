// netlify/functions/reps-sync.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Server env (required):
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - CONGRESS_API_KEY  (Data.gov key for Congress.gov API)
 */
const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY as string

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

const missingEnv = () => {
  const miss: string[] = []
  if (!SUPABASE_URL) miss.push('SUPABASE_URL')
  if (!SUPABASE_SERVICE_ROLE_KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!CONGRESS_API_KEY) miss.push('CONGRESS_API_KEY')
  return miss
}

// -------- Congress.gov shapes (simplified) --------
type MemberListItem = {
  bioguideId?: string
  name?: string
  partyName?: string
  state?: string
  district?: number | string | null
  depiction?: { imageUrl?: string | null } | null
  terms?: any
}

type MemberDetail = {
  member?: {
    bioguideId?: string
    currentMember?: boolean
    directOrderName?: string
    officialWebsiteUrl?: string
    state?: string
    stateCode?: string
    district?: number | string | null
    addressInformation?: { phoneNumber?: string | null }
    partyHistory?: Array<{ partyName?: string }>
    depiction?: { imageUrl?: string | null }
    terms?: Array<{
      chamber?: string
      congress?: number
      district?: number | string | null
      stateCode?: string
    }>
  }
}

// -------- HTTP helpers --------
const jsonFetch = async (url: string) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Fetch failed ${res.status}: ${text || url}`)
  }
  return res.json()
}

const congressApi = (pathOrQuery: string) => {
  // Accept either "member?state=TX..." or "/member/TX/10"
  const root = 'https://api.congress.gov/v3/'
  const isQueryStyle = pathOrQuery.includes('?')
  const url = new URL(isQueryStyle ? `${root}${pathOrQuery}` : `${root}${pathOrQuery.replace(/^\//, '')}`)
  if (!isQueryStyle) url.searchParams.set('format', 'json')
  url.searchParams.set('api_key', CONGRESS_API_KEY)
  return url.toString()
}

const extractMembersFromList = (j: any): MemberListItem[] => {
  if (!j) return []
  if (Array.isArray(j.members)) return j.members as MemberListItem[]
  if (j.results && Array.isArray(j.results)) return j.results as MemberListItem[]
  if (j.members && Array.isArray(j.members.member)) return j.members.member as MemberListItem[]
  return []
}

// -------- Normalization helpers --------
const normalizeState = (s?: string | null) =>
  (s || '').toString().trim().toUpperCase() || null

const normalizeDistrictString = (d?: string | number | null) => {
  if (d === null || d === undefined || d === '') return null
  const n = Number(d)
  return Number.isFinite(n) ? String(n) : String(d).trim()
}

/** Build an OCD division id like:
 *  - Senators: ocd-division/country:us/state:tx
 *  - House:    ocd-division/country:us/state:tx/cd:10
 */
const buildOcdDivisionId = (state2: string | null, chamber: 'senate' | 'house', district: string | null) => {
  const base = 'ocd-division/country:us'
  const st = state2 ? `/state:${state2.toLowerCase()}` : ''
  if (chamber === 'senate') return `${base}${st}`
  // House member needs district; if missing, use state-level as fallback (satisfy NOT NULL)
  if (district) {
    // OCD uses non-padded cd (e.g., cd:7), so ensure numeric where possible
    const n = Number(district)
    const cd = Number.isFinite(n) ? String(n) : district
    return `${base}${st}/cd:${cd}`
  }
  return `${base}${st}`
}

// -------- Detail fetch --------
const getMemberDetail = async (bioguideId: string): Promise<MemberDetail> => {
  const url = congressApi(`member/${encodeURIComponent(bioguideId)}?format=json`)
  return jsonFetch(url)
}

// Normalize to your DB row (uses office_name, division_id, etc.)
const toRepRow = (
  listItem: MemberListItem,
  detail: MemberDetail,
  chamber: 'senate' | 'house',
  expectedState: string
) => {
  const m = detail?.member ?? {}
  const photo = m?.depiction?.imageUrl ?? listItem?.depiction?.imageUrl ?? null
  const website = m?.officialWebsiteUrl ?? null
  const phone = m?.addressInformation?.phoneNumber ?? null

  const state = normalizeState(m?.stateCode || listItem?.state)
  const district = chamber === 'house'
    ? normalizeDistrictString(m?.district ?? listItem?.district)
    : null

  // Federal members rarely publish emails; treat website as a contact form URL.
  const contact_form_url = website || null

  // Division ID (NOT NULL in your table)
  const division_id = buildOcdDivisionId(state || expectedState, chamber, district)

  return {
    civic_person_id: (m?.bioguideId || listItem?.bioguideId || '').trim() || null,

    name: m?.directOrderName || listItem?.name || null,
    party: m?.partyHistory?.[0]?.partyName || (listItem?.partyName ?? null),
    photo_url: photo,

    office_name: chamber === 'senate' ? 'U.S. Senator' : 'U.S. Representative',
    level: 'federal',
    chamber,

    state: state || expectedState,
    district,

    division_id,               // <-- required by your schema
    contact_email: null,
    contact_form_url,
    phone,
    website,

    twitter: null,
    facebook: null,

    term_end: null,
    active: true,
    last_synced: new Date().toISOString(),
  }
}

const upsertRep = async (row: any) => {
  // Upsert on civic_person_id (unique)
  const { data, error } = await (supabase as any)
    .from('representatives')
    .upsert(row, { onConflict: 'civic_person_id' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data?.id as string | null
}

// -------- Netlify handler --------
export const handler: Handler = async (event) => {
  try {
    const miss = missingEnv()
    if (miss.length) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, message: `Missing: ${miss.join(', ')}` }) }
    }
    if (!supabase) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, message: 'Supabase client not initialized' }) }
    }

    const qs = event.queryStringParameters || {}

    // For now we require state; ZIP→district lands in the next microstep.
    const state = normalizeState(qs.state || '')
    const houseDistrict = normalizeDistrictString(qs.house_district || '')
    const includeHouse = qs.include_house !== 'false' // default true
    const includeSenate = qs.include_senate !== 'false' // default true

    if (!state) {
      if (qs.zip) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            ok: false,
            message:
              'ZIP→district mapping arrives next. For now, call with ?state=TX (optionally &house_district=10).'
          }),
        }
      }
      return { statusCode: 400, body: JSON.stringify({ ok: false, message: 'Provide ?state=TX (2-letter code).' }) }
    }

    const results: any[] = []

    // ----- Senate (current members for state) -----
    if (includeSenate) {
      let senateList: MemberListItem[] = []
      try {
        const url = congressApi(`member?state=${state}&chamber=Senate&currentMember=true&format=json`)
        const j = await jsonFetch(url)
        senateList = extractMembersFromList(j)
        // Ensure state match
        senateList = senateList.filter(m => normalizeState(m.state) === state)

        // Fallback: if the API ignores chamber param, try without and filter locally
        if (!senateList.length) {
          const altUrl = congressApi(`member?state=${state}&currentMember=true&format=json`)
          const j2 = await jsonFetch(altUrl)
          const all = extractMembersFromList(j2)
          senateList = all.filter((m: any) => {
            const isState = normalizeState(m.state) === state
            const terms = (m?.terms?.item || m?.terms || []) as any[]
            const isSenate = terms.some(t => String(t?.chamber || '').toLowerCase().includes('senate'))
            return isState && isSenate
          })
        }
      } catch (e) {
        results.push({ scope: 'senate', ok: false, error: (e as Error).message })
      }

      for (const m of senateList) {
        const bioguide = (m.bioguideId || '').trim()
        if (!bioguide) continue
        try {
          const detail = await getMemberDetail(bioguide)
          const row = toRepRow(m, detail, 'senate', state)
          if (!row.civic_person_id) continue
          await upsertRep(row)
          results.push({ scope: 'senate', ok: true, bioguideId: bioguide })
        } catch (e) {
          results.push({ scope: 'senate', ok: false, bioguideId: bioguide, error: (e as Error).message })
        }
      }
    }

    // ----- House (current members) -----
    if (includeHouse) {
      let houseList: MemberListItem[] = []
      try {
        if (houseDistrict) {
          const url = congressApi(`member/${state}/${encodeURIComponent(houseDistrict)}?currentMember=true&format=json`)
          const j = await jsonFetch(url)
          houseList = extractMembersFromList(j)
        } else {
          const url = congressApi(`member?state=${state}&chamber=House&currentMember=true&format=json`)
          const j = await jsonFetch(url)
          houseList = extractMembersFromList(j)
        }
        // Ensure state (and district if specified)
        houseList = houseDistrict
          ? houseList.filter(m => normalizeState(m.state) === state && normalizeDistrictString(m.district) === houseDistrict)
          : houseList.filter(m => normalizeState(m.state) === state)
      } catch (e) {
        results.push({ scope: 'house', ok: false, error: (e as Error).message })
      }

      for (const m of houseList) {
        const bioguide = (m.bioguideId || '').trim()
        if (!bioguide) continue
        try {
          const detail = await getMemberDetail(bioguide)
          const row = toRepRow(m, detail, 'house', state)
          if (!row.civic_person_id) continue
          await upsertRep(row)
          results.push({ scope: 'house', ok: true, bioguideId: bioguide, district: row.district })
        } catch (e) {
          results.push({ scope: 'house', ok: false, bioguideId: bioguide, error: (e as Error).message })
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        state,
        houseDistrict: houseDistrict || null,
        count: results.filter(r => r.ok).length,
        results,
      }),
    }
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, message: e?.message || 'Server error' }) }
  }
}
