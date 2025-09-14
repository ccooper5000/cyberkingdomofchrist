// netlify/functions/geo-enrich.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

// Census Geocoder "Find Address Geographies" endpoint (returns CD and state-legislative geos)
const CENSUS_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/address'

type GeoResult = {
  state?: string | null
  cd?: string | null         // congressional district number
  sd?: string | null         // state senate district
  hd?: string | null         // state house/assembly district
}

async function fetchGeosForAddress(oneLine: string): Promise<GeoResult> {
  const url = new URL(CENSUS_ENDPOINT)
  url.searchParams.set('benchmark', 'Public_AR_Current') // current TIGER
  url.searchParams.set('vintage', 'Current_Current')
  url.searchParams.set('format', 'json')
  url.searchParams.set('address', oneLine)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Census geocoder failed: ${res.status}`)
  const json: any = await res.json()

  // Pull geographies by name
  const geos = json?.result?.addressMatches?.[0]?.geographies || {}
  const stateCode = json?.result?.addressMatches?.[0]?.addressComponents?.state || null

  const cdName = geos['Congressional Districts']?.[0]?.NAME || null // e.g. "Congressional District 10"
  const cd = cdName ? cdName.replace(/\D+/g, '') || 'At-Large' : null

  // State Legislative Districts (Upper/Lower)
  const sldu = geos['State Legislative Districts - Upper']?.[0]?.NAME || null
  const sldl = geos['State Legislative Districts - Lower']?.[0]?.NAME || null
  const sd = sldu ? sldu.replace(/\D+/g, '') : null
  const hd = sldl ? sldl.replace(/\D+/g, '') : null

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
  if (!supabase) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not initialized' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    // Accept either full parts or just ZIP (we prefer full address for accuracy)
    const { user_id, line1, city, state, postal_code } = body || {}

    if (!user_id || !postal_code) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Require user_id and postal_code' }) }
    }

    // Build one-line address; if only ZIP is provided, geocoder may be ambiguous; we’ll still try.
    const parts = [line1, city, state, postal_code].filter(Boolean)
    const oneLine = parts.length ? parts.join(', ') : String(postal_code)

    const { state: st, cd, sd, hd } = await fetchGeosForAddress(oneLine)

    // Persist to the user’s primary address row
    const { error: updErr } = await supabase
      .from('user_addresses')
      .update({
        state: st || state || null,
        cd: cd || null,
        sd: sd || null,
        hd: hd || null,
      })
      .eq('user_id', user_id)
      .eq('is_primary', true)

    if (updErr) throw updErr

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, state: st || state || null, cd, sd, hd }) }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'Server error' }) }
  }
}
