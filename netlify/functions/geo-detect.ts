// netlify/functions/geo-detect.ts
import type { Handler } from '@netlify/functions'

// Census Geocoder (no key required)
const BASE = 'https://geocoding.geo.census.gov/geocoder'

// Layer-name matcher (handles year/vintage variations)
function pickLayer<T = any>(geos: Record<string, T[] | undefined>, includes: string[]) {
  const keys = Object.keys(geos || {})
  const found = keys.find(k => includes.some(s => k.toLowerCase().includes(s)))
  return found ? geos[found] : undefined
}

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

async function fetchJSON(url: URL) {
  const resp = await fetch(url.toString())
  const txt = await resp.text()
  let json: any = null
  try { json = JSON.parse(txt) } catch {}
  return { ok: resp.ok, status: resp.status, json, txt }
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

    // Guard: ZIP-only is ambiguous
    const zipOnly = !!zip && !street && !city && !state
    if (!zip || zipOnly) {
      const note = !zip
        ? 'Provide ZIP (and ideally state or city/street) to detect districts.'
        : 'ZIP-only is ambiguous. Add your state or city/street for accurate district detection.'
      const empty: GeoResult = { state: null, cd: null, sd: null, hd: null, note }
      return { statusCode: 200, headers, body: JSON.stringify(empty) }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1) Get coordinates for the address (locations API)
    // Prefer structured; fallback to oneline.
    // ──────────────────────────────────────────────────────────────────────────
    let loc: any | null = null

    // Structured query
    {
      const u = new URL(`${BASE}/locations/address`)
      if (street) u.searchParams.set('street', street)
      if (city) u.searchParams.set('city', city)
      if (state) u.searchParams.set('state', state)
      if (zip) u.searchParams.set('zip', zip)
      u.searchParams.set('benchmark', 'Public_AR_Current')
      u.searchParams.set('format', 'json')

      const { ok, json } = await fetchJSON(u)
      const matches = json?.result?.addressMatches
      if (ok && Array.isArray(matches) && matches.length > 0) {
        loc = matches[0]
      }
    }

    // Fallback: oneline
    if (!loc) {
      const oneline = [street, city, state, zip].filter(Boolean).join(', ')
      const u = new URL(`${BASE}/locations/onelineaddress`)
      u.searchParams.set('address', oneline)
      u.searchParams.set('benchmark', 'Public_AR_Current')
      u.searchParams.set('format', 'json')

      const { ok, json } = await fetchJSON(u)
      const matches = json?.result?.addressMatches
      if (ok && Array.isArray(matches) && matches.length > 0) {
        loc = matches[0]
      }
    }

    if (!loc?.coordinates?.x || !loc?.coordinates?.y) {
      const soft: GeoResult = {
        state: null, cd: null, sd: null, hd: null,
        note: 'Could not geocode that address. Try adjusting city/street and ensure a 2-letter state.',
      }
      return { statusCode: 200, headers, body: JSON.stringify(soft) }
    }

    const { x, y } = loc.coordinates

    // Capture state from the geocoder’s normalized components if present
    const matchedState: string | null =
      (loc?.addressComponents?.state || state || null) ? String(loc?.addressComponents?.state || state).toUpperCase() : null

    // ──────────────────────────────────────────────────────────────────────────
    // 2) Ask for geographies at those coordinates (district layers)
    // ──────────────────────────────────────────────────────────────────────────
    const g = new URL(`${BASE}/geographies/coordinates`)
    g.searchParams.set('x', String(x)) // longitude
    g.searchParams.set('y', String(y)) // latitude
    g.searchParams.set('benchmark', 'Public_AR_Current')
    g.searchParams.set('vintage', 'Current_Current')
    g.searchParams.set('format', 'json')

    const { ok: gOk, json: gJson } = await fetchJSON(g)
    if (!gOk) {
      const soft: GeoResult = {
        state: matchedState, cd: null, sd: null, hd: null,
        note: 'Census did not return district layers for those coordinates. Try a more precise street/city.',
      }
      return { statusCode: 200, headers, body: JSON.stringify(soft) }
    }

    const geos = gJson?.result?.geographies || {}

    // Match layers by fuzzy key (handles year/prefix variations)
    const cdArr   = pickLayer(geos, ['congressional district'])
    const slduArr = pickLayer(geos, ['state legislative districts - upper', 'sldu'])
    const sldlArr = pickLayer(geos, ['state legislative districts - lower', 'sldl'])

    // Extract numbers
    let cd: string | null = null
    if (cdArr?.[0]?.NAME) {
      const name = String(cdArr[0].NAME)
      cd = name.match(/\d+/)?.[0] || 'At-Large'
    }

    let sd: string | null = null
    if (slduArr?.[0]?.NAME) {
      const name = String(slduArr[0].NAME)
      sd = name.match(/\d+/)?.[0] || null
    }

    let hd: string | null = null
    if (sldlArr?.[0]?.NAME) {
      const name = String(sldlArr[0].NAME)
      hd = name.match(/\d+/)?.[0] || null
    }

    const result: GeoResult = {
      state: matchedState,
      cd, sd, hd,
    }

    if (!cd && !sd && !hd) {
      result.note = 'No districts found. Try removing ZIP+4 and abbreviating road types (e.g., “Rd”, “Ave”).'
    }

    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (e: any) {
    const soft: GeoResult = {
      state: null, cd: null, sd: null, hd: null,
      note: e?.message || 'Server error during geocode.',
    }
    return { statusCode: 200, headers, body: JSON.stringify(soft) }
  }
}

export default handler
