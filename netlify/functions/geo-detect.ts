// netlify/functions/geo-detect.ts
import type { Handler } from '@netlify/functions'

// Census Geocoder (no key required)
const CENSUS_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/address'

type Payload = {
  line1?: string | null
  city?: string | null
  state?: string | null // 2-letter
  postal_code?: string | null
}

type GeoResult = {
  state: string | null
  cd: string | null
  sd: string | null
  hd: string | null
  note?: string | null
}

function toOneLine(p: Payload): string {
  const parts = [p.line1, p.city, p.state, p.postal_code].filter(Boolean)
  // If we have at least two parts (e.g., "TX" + "78239" or "Austin" + "TX"), it’s usually good enough.
  if (parts.length >= 2) return parts.join(', ')
  // Fallback: if we have both state and ZIP, join them
  if (p.state && p.postal_code) return `${p.postal_code} ${p.state}`
  // Otherwise return what we have (may be ZIP-only)
  return (p.postal_code ?? '').trim()
}

function parseGeos(json: any): GeoResult {
  const match = json?.result?.addressMatches?.[0]
  const geos = match?.geographies || {}
  const stateCode = match?.addressComponents?.state || null

  const cdName = geos['Congressional Districts']?.[0]?.NAME || null
  let cd: string | null = null
  if (cdName) {
    const digits = cdName.match(/\d+/)?.[0]
    cd = digits || 'At-Large'
  }

  const sldu = geos['State Legislative Districts - Upper']?.[0]?.NAME || null
  const sldl = geos['State Legislative Districts - Lower']?.[0]?.NAME || null
  const sd = sldu ? (sldu.match(/\d+/)?.[0] || null) : null
  const hd = sldl ? (sldl.match(/\d+/)?.[0] || null) : null

  return { state: stateCode || null, cd, sd, hd }
}

export const handler: Handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Use POST' }) }
  }

  try {
    const body: Payload = JSON.parse(event.body || '{}')

    // Build a usable one-line address
    const oneLine = toOneLine(body)

    // If this is ZIP-only (no state/city/street), the Census endpoint often 400s.
    // Return a 200 with empty results and a gentle note instead of bubbling a 400.
    const zipOnly = !!oneLine && /^\d{5}(-\d{4})?$/.test(oneLine) &&
      !body.state && !body.city && !body.line1
    if (!oneLine || zipOnly) {
      const note = !oneLine
        ? 'Provide ZIP (and ideally city or street) to detect districts.'
        : 'ZIP-only is ambiguous. Add your state or city/street for accurate district detection.'
      const empty: GeoResult = { state: null, cd: null, sd: null, hd: null, note }
      return { statusCode: 200, headers, body: JSON.stringify(empty) }
    }

    const url = new URL(CENSUS_ENDPOINT)
    url.searchParams.set('benchmark', 'Public_AR_Current')
    url.searchParams.set('vintage', 'Current_Current')
    url.searchParams.set('format', 'json')
    url.searchParams.set('address', oneLine)

    const resp = await fetch(url.toString())
    const text = await resp.text()

    // If Census returns a non-OK status, don’t fail the UI — return empty with a helpful note.
    if (!resp.ok) {
      const soft: GeoResult = {
        state: null, cd: null, sd: null, hd: null,
        note: `Census returned ${resp.status}. Try adding city/street with your ZIP.`,
      }
      return { statusCode: 200, headers, body: JSON.stringify(soft) }
    }

    const json = JSON.parse(text)
    const result = parseGeos(json)
    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (e: any) {
    // Unexpected server error — still keep the UI happy with a 200 + empty payload.
    const soft: GeoResult = {
      state: null, cd: null, sd: null, hd: null,
      note: e?.message || 'Server error during geocode.',
    }
    return { statusCode: 200, headers, body: JSON.stringify(soft) }
  }
}

export default handler
