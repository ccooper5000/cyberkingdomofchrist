// netlify/functions/civic-sync.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

// ---- Environment (server-only) ----
const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string
const GOOGLE_CIVIC_API_KEY = process.env.GOOGLE_CIVIC_API_KEY as string

function missingEnv(): string[] {
  const miss: string[] = []
  if (!SUPABASE_URL) miss.push('SUPABASE_URL')
  if (!SUPABASE_SERVICE_ROLE_KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!GOOGLE_CIVIC_API_KEY) miss.push('GOOGLE_CIVIC_API_KEY')
  return miss
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

// Helpers
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')

function parseStateFromDivision(divisionId: string): string | null {
  const m = divisionId.match(/state:([a-z]{2})\b/i)
  return m ? m[1].toUpperCase() : null
}

function normalizeDistrict(divisionId: string): string | null {
  const m = divisionId.match(/\/cd:(\d+)\b/i) // congressional district
  return m ? m[1].padStart(2, '0') : null
}

function detectLevel(divisionId: string, officeName: string): 'federal' | 'state' | 'local' {
  if (/\/country:us\b/i.test(divisionId) && /president|vice|u\.?s\.?/i.test(officeName)) return 'federal'
  if (/\/cd:\d+/.test(divisionId)) return 'federal' // US House
  if (/U\.?S\.?\s+Senator/i.test(officeName)) return 'federal'
  if (/state:/i.test(divisionId)) return 'state'
  return 'local'
}

function detectChamber(officeName: string, divisionId: string): string | null {
  const n = officeName.toLowerCase()
  if (n.includes('senator') && /state:/.test(divisionId) && !/u\.?s\.?\s+senator/i.test(officeName)) return 'upper'
  if ((n.includes('representative') || n.includes('assembly')) && /state:/.test(divisionId)) return 'lower'
  if (n.includes('u.s.') && n.includes('senator')) return 'senate'
  if (n.includes('u.s.') && (n.includes('representative') || n.includes('house'))) return 'house'
  if (n.includes('governor') || n.includes('president') || n.includes('executive')) return 'executive'
  return null
}

type CivicOffice = {
  name: string
  divisionId: string
  officialIndices: number[]
}

type CivicOfficial = {
  name: string
  party?: string
  photoUrl?: string
  emails?: string[]
  urls?: string[]
  phones?: string[]
  channels?: { type: string; id: string }[]
}

export const handler: Handler = async (event) => {
  try {
    const missing = missingEnv()
    if (missing.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: false, message: `civic-sync not configured: missing ${missing.join(', ')}` }),
      }
    }
    if (!supabase) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, message: 'Supabase client not initialized' }) }
    }

    const zip = (event.queryStringParameters?.zip || '').trim()
    if (!/^\d{5}$/.test(zip)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, message: 'Provide ?zip=12345' }) }
    }

    const endpoint = new URL('https://civicinfo.googleapis.com/civicinfo/v2/representatives')
    endpoint.searchParams.set('address', zip)
    endpoint.searchParams.set('includeOffices', 'true')
    endpoint.searchParams.set('levels', 'country') // federal
    endpoint.searchParams.append('levels', 'administrativeArea1') // state
    endpoint.searchParams.set('key', GOOGLE_CIVIC_API_KEY)

    const res = await fetch(endpoint.toString())
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { statusCode: res.status, body: JSON.stringify({ ok: false, message: 'Civic API error', detail: text }) }
    }
    const payload = (await res.json()) as {
      offices?: CivicOffice[]
      officials?: CivicOfficial[]
    }

    const offices = payload.offices ?? []
    const officials = payload.officials ?? []
    const results: any[] = []

    for (const office of offices) {
      const divisionId = office.divisionId
      const officeName = office.name
      const state = parseStateFromDivision(divisionId)
      const level = detectLevel(divisionId, officeName)
      const chamber = detectChamber(officeName, divisionId)
      const district = normalizeDistrict(divisionId)

      for (const idx of office.officialIndices) {
        const o = officials[idx]
        if (!o) continue

        // Civic API has no stable person id; build a deterministic surrogate
        const civic_person_id = sha1(`${o.name}|${officeName}|${divisionId}`)

        const contact_email = o.emails?.[0] || null
        const website = o.urls?.[0] || null
        const phone = o.phones?.[0] || null
        const twitter = o.channels?.find((c) => c.type === 'Twitter')?.id || null
        const facebook = o.channels?.find((c) => c.type === 'Facebook')?.id || null
        const contact_form_url = !contact_email && website ? website : null

        const repRow = {
          civic_person_id,
          civic_office_id: null as string | null,
          name: o.name,
          party: o.party || null,
          photo_url: o.photoUrl || null,
          office_name: officeName,
          level,
          chamber,
          state,
          district,
          contact_email,
          contact_form_url,
          phone,
          website,
          twitter,
          facebook,
          term_end: null as string | null,
          active: true,
          last_synced: new Date().toISOString(),
        }

        const { data: upData, error: upErr } = await supabase
          .from('representatives')
          .upsert(repRow, { onConflict: 'civic_person_id' })
          .select('id')
          .single()

        if (upErr) {
          results.push({ office: officeName, name: o.name, ok: false, error: upErr.message })
          continue
        }

        const repId = upData?.id
        if (repId) {
          await supabase
            .from('representative_divisions')
            .upsert(
              { rep_id: repId, ocd_division_id: divisionId },
              { onConflict: 'rep_id,ocd_division_id' }
            )
        }

        results.push({ office: officeName, name: o.name, ok: true })
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, zip, count: results.length, results }) }
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, message: e?.message || 'Server error' }) }
  }
}
