// netlify/functions/geo-detect.ts
import type { Handler } from '@netlify/functions'

// Census Geocoder (no key required)
const BASE = 'https://geocoding.geo.census.gov/geocoder/geographies'

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
    const street = (body.line1 || '').trim()
    const city = (body.city || '').trim()
    const state = (body.state || '').trim()
    const zip = (body.postal_code || '').trim()

    // ZIP-only is ambiguous: return a soft 200 with guidance
    const zipOnly = !!zip && !street && !city && !state
    if (!zip || zipOnly) {
      const note = !zip
        ? 'Provide ZIP (and ideally state or city/street) to detect districts.'
        : 'ZIP-only is ambiguous. Add your state or city/street for accurate district detection.'
      const empty: GeoResult = { state: null, cd: null, sd: null, hd: null, note }
      return { statusCode: 200, headers, body: JSON.stringify(empty) }
    }

    // Prefer the structured endpoint when we have any of street/city/state
    let resp: Response
    let endpointUsed: 'address' | 'oneline' = 'address'

    if (street || city || state) {
      const url = new URL(`${BASE}/address`)
      if (street) url.searchParams.set('street', street)
      if (city) url.searchParams.set('city', city)
      if (state) url.searchParams.set('state', state)
      if (zip) url.searchParams.set('zip', zip)
      url.searchParams.set('benchmark', 'Public_AR_Current')
      url.searchParams.set('vintage', 'Current_Current')
      url.searchParams.set('format', 'json')

      resp = await fetch(url.toString())
      if (!resp.ok) {
        // Fallback to oneline if structured failed (some quirky addresses)
        endpointUsed = 'oneline'
        const u2 = new URL(`${BASE}/onelineaddress`)
        u2.searchParams.set('address', [street, city, state, zip].filter(Boolean).join(', '))
        u2.searchParams.set('benchmark', 'Public_AR_Current')
        u2.searchParams.set('vintage', 'Current_Current')
        u2.searchParams.set('format', 'json')
        resp = await fetch(u2.toString())
      }
    } else {
      // Shouldn’t happen due to guard, but keep it safe
      endpointUsed = 'oneline'
      const u2 = new URL(`${BASE}/onelineaddress`)
      u2.searchParams.set('address', [zip, state].filter(Boolean).join(' '))
      u2.searchParams.set('benchmark', 'Public_AR_Current')
      u2.searchParams.set('vintage', 'Current_Current')
      u2.searchParams.set('format', 'json')
      resp = await fetch(u2.toString())
    }

    const text = await resp.text()

    // If Census still returns non-OK, respond softly with guidance instead of erroring
    if (!resp.ok) {
      const soft: GeoResult = {
        state: null, cd: null, sd: null, hd: null,
        note: `Census returned ${resp.status} via ${endpointUsed}. Try adjusting your city/street and ensure 2-letter state.`,
      }
      return { statusCode: 200, headers, body: JSON.stringify(soft) }
    }

    const json = JSON.parse(text)
    const result = parseGeos(json)

    // If parsing yielded nothing, include a tip so the UI shows guidance
    if (!result.state && !result.cd && !result.sd && !result.hd) {
      result.note = 'No districts found for that address. Try adding or correcting city/street (avoid ZIP+4).'
    }

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
