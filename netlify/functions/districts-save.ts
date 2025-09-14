// netlify/functions/districts-save.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

type SavePayload = {
  user_id: string
  // required for strong mapping
  state: string // 'TX'
  cd?: string | null // congressional district (e.g. '10' or 'At-Large')
  sd?: string | null // state senate district
  hd?: string | null // state house/assembly district
  postal_code?: string | null // keep ZIP for convenience
  // optional: if user explicitly opts in to store street
  persist_address?: boolean
  line1?: string | null
  city?: string | null
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
    const body = JSON.parse(event.body || '{}') as SavePayload
    const { user_id, state } = body
    if (!user_id || !state || state.length !== 2) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Require user_id and two-letter state' }) }
    }

    // Normalize
    const st = state.toUpperCase()
    const cd = body.cd ? String(body.cd) : null
    const sd = body.sd ? String(body.sd) : null
    const hd = body.hd ? String(body.hd) : null
    const zip = body.postal_code ? String(body.postal_code) : null

    // Update user's primary address (no street unless persist_address)
    const update: any = {
      state: st,
      cd,
      sd,
      hd,
      postal_code: zip,
    }
    if (body.persist_address) {
      update.line1 = body.line1 ?? null
      update.city = body.city ?? null
    } else {
      // ensure we don't keep street if user did not opt in
      update.line1 = null
      update.city = null
    }

    const { error: updErr } = await supabase
      .from('user_addresses')
      .update(update)
      .eq('user_id', user_id)
      .eq('is_primary', true)

    if (updErr) throw updErr

    // Trigger existing sync functions
    const calls: Promise<any>[] = []
    const params = new URLSearchParams({ state: st })
    if (cd && cd !== 'At-Large') params.set('house_district', cd)
    calls.push(fetch(`/.netlify/functions/reps-sync?${params.toString()}`))

    if (sd || hd) {
      const p2 = new URLSearchParams({ state: st })
      if (sd) p2.set('sd', sd)
      if (hd) p2.set('hd', hd)
      calls.push(fetch(`/.netlify/functions/state-reps-sync?${p2.toString()}`))
    }

    await Promise.allSettled(calls)

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'Server error' }) }
  }
}

export default handler
