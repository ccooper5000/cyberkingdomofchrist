// netlify/functions/reps-sync.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

// ── Env (server-only) ─────────────────────────────────────────────────────────
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const jsonFetch = async (url: string) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Fetch failed ${res.status}: ${text || url}`)
  }
  return res.json()
}

const congressApi = (pathOrQuery: string) => {
  // Accept either "member?currentMember=true..." or "/member/TX/10"
  const root = 'https://api.congress.gov/v3/'
  const isQueryStyle = pathOrQuery.includes('?')
  const url = new URL(isQueryStyle ? `${root}${pathOrQuery}` : `${root}${pathOrQuery.replace(/^\//, '')}`)
  if (!isQueryStyle) url.searchParams.set('format', 'json')
  url.searchParams.set('api_key', CONGRESS_API_KEY)
  return url.toString()
}

// ── Shapes (simplified) ───────────────────────────────────────────────────────
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

// ── State normalization ───────────────────────────────────────────────────────
const STATE_NAME_TO_CODE: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA',
  Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY'
}
const toUSPS = (s?: string | null) => {
  if (!s) return null
  const t = s.trim()
  if (t.length === 2) return t.toUpperCase()
  return STATE_NAME_TO_CODE[t] || null
}

// ── Congress.gov fetches ──────────────────────────────────────────────────────
// Known reliable direct endpoint for one House member by state/district.
const fetchHouseByStateDistrict = async (stateCode: string, district: string) => {
  const url = congressApi(`/member/${encodeURIComponent(stateCode)}/${encodeURIComponent(district)}`)
  const j = await jsonFetch(url)
  // Response has a members array with one item (current member for that district)
  const arr: any[] = Array.isArray(j?.members) ? j.members : []
  return arr as MemberListItem[]
}

// Fall back: page current members list and locally filter to our state.
const fetchCurrentMembersForState = async (stateCode: string) => {
  let page = 1
  const out: MemberListItem[] = []
  // We’ll scan several pages; stop early once we’ve clearly found the state’s members.
  while (page <= 6) {
    const url = congressApi(`member?currentMember=true&limit=100&page=${page}`)
    const j = await jsonFetch(url)
    const members: any[] = Array.isArray(j?.members) ? j.members : []
    for (const m of members) {
      const stateNameOrCode = (m.state || '').toString()
      const code = toUSPS(stateNameOrCode)
      if (code === stateCode) out.push(m)
    }
    const nextUrl = j?.pagination?.next
    if (!nextUrl) break
    page += 1
  }
  return out
}

const getMemberDetail = async (bioguideId: string): Promise<MemberDetail> => {
  const url = congressApi(`member/${encodeURIComponent(bioguideId)}?format=json`)
  return jsonFetch(url)
}

// ── Upsert helpers ────────────────────────────────────────────────────────────
const toRepRow = (listItem: MemberListItem, detail: MemberDetail, chamber: 'senate' | 'house') => {
  const m = detail?.member ?? {}
  const photo = m?.depiction?.imageUrl ?? listItem?.depiction?.imageUrl ?? null
  const website = m?.officialWebsiteUrl ?? null
  const phone = m?.addressInformation?.phoneNumber ?? null

  const stateCode = (m?.stateCode || listItem?.state || '').toString().toUpperCase() || null
  const district =
    chamber === 'house'
      ? (String(m?.district ?? listItem?.district ?? '') || null)
      : null

  // We rarely get direct emails at federal level; fall back to website as contact form.
  const contact_form_url = website || null

  // Required elsewhere in your DB: division_id. Senators don’t have a CD; House does.
  const division_id =
    chamber === 'senate'
      ? (stateCode ? `ocd-division/country:us/state:${stateCode.toLowerCase()}` : null)
      : (stateCode && district ? `ocd-division/country:us/state:${stateCode.toLowerCase()}/cd:${String(district).toLowerCase()}` : null)

  return {
    civic_person_id: (m?.bioguideId || listItem?.bioguideId || '').trim() || null,
    name: m?.directOrderName || listItem?.name || null,
    party: m?.partyHistory?.[0]?.partyName || (listItem?.partyName ?? null),
    photo_url: photo,

    // ✅ Match your schema
    office_name: chamber === 'senate' ? 'U.S. Senator' : 'U.S. Representative',
    level: 'federal',
    chamber,

    state: stateCode,
    district,

    contact_email: null,
    contact_form_url,
    phone,
    website,

    twitter: null,
    facebook: null,

    term_end: null,
    active: true,
    division_id,          // important if your column is NOT NULL
    last_synced: new Date().toISOString(),
  }
}

const upsertRep = async (row: any) => {
  const { data, error } = await (supabase as any)
    .from('representatives')
    .upsert(row, { onConflict: 'civic_person_id' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data?.id as string | null
}

// ── Handler ───────────────────────────────────────────────────────────────────
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
    const stateParam = (qs.state || '').toString().trim()
    const districtParam = (qs.house_district || '').toString().trim()

    const stateCode = toUSPS(stateParam) || toUSPS(stateParam.toUpperCase()) // accept “TX” or “Texas”
    if (!stateCode) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, message: 'Provide ?state=TX (2-letter) or full name' }) }
    }

    const results: Array<{ office: string; name: string; ok: boolean; error?: string }> = []

    // 1) Senators (2)
    {
      const all = await fetchCurrentMembersForState(stateCode)
      const senateCandidates = all.filter((m) => {
        const terms = (m as any)?.terms || []
        return terms.some((t: any) => String(t?.chamber || '').toLowerCase() === 'senate')
      })

      // Pull details + upsert
      for (const s of senateCandidates) {
        const detail = await getMemberDetail(s.bioguideId!)
        const row = toRepRow(s, detail, 'senate')
        try {
          const repId = await upsertRep(row)
          if (repId && row.division_id) {
            await (supabase as any)
              .from('representative_divisions')
              .upsert({ rep_id: repId, ocd_division_id: row.division_id }, { onConflict: 'rep_id,ocd_division_id' })
          }
          results.push({ office: 'U.S. Senator', name: row.name || '(unknown)', ok: true })
        } catch (e: any) {
          results.push({ office: 'U.S. Senator', name: row.name || '(unknown)', ok: false, error: e?.message || 'upsert failed' })
        }
      }
    }

    // 2) House (one or more; direct by district if provided)
    if (districtParam) {
      const list = await fetchHouseByStateDistrict(stateCode, districtParam)
      for (const h of list) {
        const detail = await getMemberDetail(h.bioguideId!)
        const row = toRepRow(h, detail, 'house')
        try {
          const repId = await upsertRep(row)
          if (repId && row.division_id) {
            await (supabase as any)
              .from('representative_divisions')
              .upsert({ rep_id: repId, ocd_division_id: row.division_id }, { onConflict: 'rep_id,ocd_division_id' })
          }
          results.push({ office: 'U.S. Representative', name: row.name || '(unknown)', ok: true })
        } catch (e: any) {
          results.push({ office: 'U.S. Representative', name: row.name || '(unknown)', ok: false, error: e?.message || 'upsert failed' })
        }
      }
    } else {
      // No specific district: fall back to list + local filter for House
      const all = await fetchCurrentMembersForState(stateCode)
      const houseCandidates = all.filter((m) => {
        const terms = (m as any)?.terms || []
        return terms.some((t: any) => String(t?.chamber || '').toLowerCase() === 'house')
      })
      for (const h of houseCandidates) {
        const detail = await getMemberDetail(h.bioguideId!)
        const row = toRepRow(h, detail, 'house')
        try {
          const repId = await upsertRep(row)
          if (repId && row.division_id) {
            await (supabase as any)
              .from('representative_divisions')
              .upsert({ rep_id: repId, ocd_division_id: row.division_id }, { onConflict: 'rep_id,ocd_division_id' })
          }
          results.push({ office: 'U.S. Representative', name: row.name || '(unknown)', ok: true })
        } catch (e: any) {
          results.push({ office: 'U.S. Representative', name: row.name || '(unknown)', ok: false, error: e?.message || 'upsert failed' })
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, state: stateCode, count: results.length, results }) }
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, message: e?.message || 'Server error' }) }
  }
}
