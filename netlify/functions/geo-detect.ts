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
}

function toOneLine(p: Payload): string {
  const parts = [p.line1, p.city, p.state, p.postal_code].filter(Boolean)
  return parts.join(', ')
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
    // Build one-line address; ZIP-only is sometimes ambiguous and may fail.
    // If only ZIP is provided, we include state when present to help disambiguate.
    const oneLine = toOneLine(body) || [body.postal_code, body.state].filter(Boolean).join(' ')
    if (!oneLine) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provide ZIP (and ideally city or street) to detect districts.' }) }
    }

    const url = new URL(CENSUS_ENDPOINT)
    url.searchParams.set('benchmark', 'Public_AR_Current')
    url.searchParams.set('vintage', 'Current_Current')
    url.searchParams.set('format', 'json')
    url.searchParams.set('address', oneLine)

    const resp = await fetch(url.toString())
    const text = await resp.text()
    if (!resp.ok) {
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: `Census error ${resp.status}`, details: text.slice(0, 500) }) }
    }

    const json = JSON.parse(text)
    const result = parseGeos(json)
    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'Server error' }) }
  }
}

export default handler
