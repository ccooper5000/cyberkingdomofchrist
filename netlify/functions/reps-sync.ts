// netlify/functions/reps-sync.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * Required env:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *  - CONGRESS_API_KEY  (Data.gov key for Congress.gov)
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

// ---------- HTTP helpers ----------
const jsonFetch = async (url: string) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Fetch failed ${res.status}: ${text || url}`)
  }
  return res.json()
}
const congressApi = (pathOrQuery: string) => {
  const root = 'https://api.congress.gov/v3/'
  const isQueryStyle = pathOrQuery.includes('?')
  const url = new URL(isQueryStyle ? `${root}${pathOrQuery}` : `${root}${pathOrQuery.replace(/^\//, '')}`)
  if (!isQueryStyle) url.searchParams.set('format', 'json')
  url.searchParams.set('api_key', CONGRESS_API_KEY)
  return url.toString()
}

// ---------- Shapes ----------
type MemberListItem = {
  bioguideId?: string
  name?: string
  partyName?: string
  state?: string // may be "TX" or "Texas"
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
    terms?: Array<{ chamber?: string; congress?: number; district?: number | string | null; stateCode?: string }>
  }
}

// ---------- State normalization ----------
const STATE_TO_CODE: Record<string, string> = {
  ALABAMA:'AL', ALASKA:'AK', 'AMERICAN SAMOA':'AS', ARIZONA:'AZ', ARKANSAS:'AR', CALIFORNIA:'CA',
  COLORADO:'CO', CONNECTICUT:'CT', DELAWARE:'DE', 'DISTRICT OF COLUMBIA':'DC', FLORIDA:'FL',
  GEORGIA:'GA', GUAM:'GU', HAWAII:'HI', IDAHO:'ID', ILLINOIS:'IL', INDIANA:'IN', IOWA:'IA',
  KANSAS:'KS', KENTUCKY:'KY', LOUISIANA:'LA', MAINE:'ME', 'MARSHALL ISLANDS':'MH',
  MARYLAND:'MD', MASSACHUSETTS:'MA', MICHIGAN:'MI', MINNESOTA:'MN', MISSISSIPPI:'MS',
  MISSOURI:'MO', MONTANA:'MT', NEBRASKA:'NE', NEVADA:'NV', 'NEW HAMPSHIRE':'NH',
  'NEW JERSEY':'NJ', 'NEW MEXICO':'NM', 'NEW YORK':'NY', 'NORTH CAROLINA':'NC',
  'NORTH DAKOTA':'ND', 'NORTHERN MARIANA ISLANDS':'MP', OHIO:'OH', OKLAHOMA:'OK', OREGON:'OR',
  PALAU:'PW', PENNSYLVANIA:'PA', 'PUERTO RICO':'PR', 'RHODE ISLAND':'RI',
  'SOUTH CAROLINA':'SC', 'SOUTH DAKOTA':'SD', TENNESSEE:'TN', TEXAS:'TX', UTAH:'UT',
  VERMONT:'VT', 'VIRGIN ISLANDS':'VI', VIRGINIA:'VA', WASHINGTON:'WA', 'WEST VIRGINIA':'WV',
  WISCONSIN:'WI', WYOMING:'WY'
}
const toUSPS = (s?: string | null): string | null => {
  if (!s) return null
  const t = s.trim()
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase()
  const up = t.toUpperCase()
  return STATE_TO_CODE[up] || null
}
const normalizeDistrictString = (d?: string | number | null) => {
  if (d === null || d === undefined || d === '') return null
  const n = Number(d)
  return Number.isFinite(n) ? String(n) : String(d).trim()
}

// ---------- Division ID ----------
const buildOcdDivisionId = (state2: string | null, chamber: 'senate' | 'house', district: string | null) => {
  const base = 'ocd-division/country:us'
  const st = state2 ? `/state:${state2.toLowerCase()}` : ''
  if (chamber === 'senate') return `${base}${st}`
  if (district) {
    const n = Number(district)
    const cd = Number.isFinite(n) ? String(n) : district
    return `${base}${st}/cd:${cd}`
  }
  return `${base}${st}`
}

// ---------- Extractors ----------
const extractMembersFromList = (j: any): MemberListItem[] => {
  if (!j) return []
  if (Array.isArray(j.members)) return j.members
  if (j.results && Array.isArray(j.results)) return j.results
  if (j.members && Array.isArray(j.members.member)) return j.members.member
  return []
}
const getMemberDetail = async (bioguideId: string): Promise<MemberDetail> => {
  const url = congressApi(`member/${encodeURIComponent(bioguideId)}?format=json`)
  return jsonFetch(url)
}
const termsIndicateChamber = (m: any, chamber: 'senate' | 'house') => {
  const arr = (m?.terms?.item || m?.terms || []) as any[]
  const want = chamber === 'senate' ? 'senate' : 'house'
  return arr.some(t => String(t?.chamber || '').toLowerCase().includes(want))
}

// ---------- DB ----------
const upsertRep = async (row: any) => {
  // IMPORTANT: matches your outreach function expectations
  // - office  (string)
  // - email   (string | null)
  // - division_id (NOT NULL)
  const { data, error } = await (supabase as any)
    .from('representatives')
    .upsert(row, { onConflict: 'civic_person_id' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data?.id as string | null
}

// ---------- Gatherers with fallbacks ----------
async function gatherCurrentMembers(
  takeUntil: (m: MemberListItem) => boolean,
  needCount: number,
  maxPages = 30,
  pageSize = 100
): Promise<MemberListItem[]> {
  let url = congressApi(`member?currentMember=true&format=json&limit=${pageSize}`)
  const picked: MemberListItem[] = []
  let page = 0
  while (page < maxPages) {
    const j = await jsonFetch(url)
    const batch = extractMembersFromList(j)
    for (const m of batch) {
      if (takeUntil(m)) {
        picked.push(m)
        if (picked.length >= needCount) return picked
      }
    }
    const next = j?.pagination?.next
    if (!next) break
    url = next
    page += 1
  }
  return picked
}
async function findStateSenators(state2: string): Promise<MemberListItem[]> {
  try {
    const primary = congressApi(`member?state=${state2}&currentMember=true&format=json&limit=100`)
    const j = await jsonFetch(primary)
    const all = extractMembersFromList(j)
    const filtered = all.filter(m => toUSPS(m.state) === state2 && termsIndicateChamber(m, 'senate'))
    if (filtered.length >= 2) return filtered.slice(0, 2)
  } catch {}
  return gatherCurrentMembers(
    (m) => toUSPS(m.state) === state2 && termsIndicateChamber(m, 'senate'),
    2
  )
}
async function findStateHouse(state2: string, district: string | null): Promise<MemberListItem[]> {
  if (district) {
    try {
      const j = await jsonFetch(congressApi(`member/${state2}/${encodeURIComponent(district)}?currentMember=true&format=json`))
      const list = extractMembersFromList(j)
      const filtered = list.filter(m => toUSPS(m.state) === state2 && normalizeDistrictString(m.district) === district)
      if (filtered.length) return [filtered[0]]
    } catch {}
  }
  return gatherCurrentMembers(
    (m) => {
      const isState = toUSPS(m.state) === state2
      if (!isState) return false
      if (!district) return termsIndicateChamber(m, 'house')
      return normalizeDistrictString(m.district) === district && termsIndicateChamber(m, 'house')
    },
    district ? 1 : 36
  )
}

// ---------- Row normalization (matches your schema) ----------
const toRepRow = (
  listItem: MemberListItem,
  detail: MemberDetail,
  chamber: 'senate' | 'house',
  expectedState2: string
) => {
  const m = detail?.member ?? {}
  const photo = m?.depiction?.imageUrl ?? listItem?.depiction?.imageUrl ?? null
  const website = m?.officialWebsiteUrl ?? null
  const phone = m?.addressInformation?.phoneNumber ?? null

  const state2 = toUSPS(m?.stateCode || listItem?.state) || expectedState2
  const district = chamber === 'house'
    ? normalizeDistrictString(m?.district ?? listItem?.district)
    : null

  const division_id = buildOcdDivisionId(state2, chamber, district)

  return {
    civic_person_id: (m?.bioguideId || listItem?.bioguideId || '').trim() || null,

    name: m?.directOrderName || listItem?.name || null,
    party: m?.partyHistory?.[0]?.partyName || (listItem?.partyName ?? null),
    photo_url: photo,

    // IMPORTANT: your schema/outreach expects 'office' and 'email'
    office: chamber === 'senate' ? 'U.S. Senator' : 'U.S. Representative',
    email: null, // Congress.gov rarely provides email; stays null for federal

    level: 'federal',
    chamber,

    state: state2,
    district,
    division_id,

    website,
    phone,

    twitter: null,
    facebook: null,

    term_end: null,
    active: true,
    last_synced: new Date().toISOString(),
  }
}

// ---------- Handler ----------
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
    const state2 = toUSPS((qs.state || '').toString())
    const houseDistrict = normalizeDistrictString(qs.house_district || '')
    const includeHouse = qs.include_house !== 'false'
    const includeSenate = qs.include_senate !== 'false'

    if (!state2) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, message: 'Provide ?state=TX (two-letter or full name).' }) }
    }

    const results: any[] = []

    if (includeSenate) {
      const senateList = (await findStateSenators(state2))
        .filter(m => toUSPS(m.state) === state2 && termsIndicateChamber(m, 'senate'))
        .slice(0, 2)

      for (const m of senateList) {
        const bioguide = (m.bioguideId || '').trim()
        if (!bioguide) continue
        try {
          const detail = await getMemberDetail(bioguide)
          const row = toRepRow(m, detail, 'senate', state2)
          if (!row.civic_person_id) continue
          await upsertRep(row)
          results.push({ scope: 'senate', ok: true, bioguideId: bioguide })
        } catch (e) {
          results.push({ scope: 'senate', ok: false, bioguideId: bioguide, error: (e as Error).message })
        }
      }
    }

    if (includeHouse) {
      const houseList = await findStateHouse(state2, houseDistrict || null)
      const filtered = houseDistrict
        ? houseList.filter(m => toUSPS(m.state) === state2 && normalizeDistrictString(m.district) === houseDistrict && termsIndicateChamber(m, 'house')).slice(0, 1)
        : houseList.filter(m => toUSPS(m.state) === state2 && termsIndicateChamber(m, 'house'))

      for (const m of filtered) {
        const bioguide = (m.bioguideId || '').trim()
        if (!bioguide) continue
        try {
          const detail = await getMemberDetail(bioguide)
          const row = toRepRow(m, detail, 'house', state2)
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
        state: state2,
        houseDistrict: houseDistrict || null,
        count: results.filter(r => r.ok).length,
        results,
      }),
    }
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, message: e?.message || 'Server error' }) }
  }
}
