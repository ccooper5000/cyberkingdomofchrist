// src/components/profile/ProfileAddressPanel.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { assignRepsForCurrentUser } from '@/lib/reps'

type AddressInfo = {
  postal_code: string | null
  state: string | null
  city: string | null
  line1: string | null
  cd: string | null // congressional district
  sd: string | null // state senate (upper) district
  hd: string | null // state house/assembly (lower) district
}

type GeoResult = {
  state: string | null
  cd: string | null
  sd: string | null
  hd: string | null
}

// Server-side proxy (avoids Census CORS issues)
async function geocodeAddressViaServer(payload: {
  line1?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
}): Promise<GeoResult> {
  const res = await fetch('/.netlify/functions/geo-detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(j?.error || 'Detection failed.')
  return j as GeoResult
}

export default function ProfileAddressPanel() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // Stored/current address (for display/prefill)
  const [addr, setAddr] = useState<AddressInfo>({
    postal_code: null, state: null, city: null, line1: null, cd: null, sd: null, hd: null
  })

  // Form fields (user input)
  const [postal, setPostal] = useState('')
  const [st, setSt] = useState('')         // two-letter state (optional, helps the geocoder)
  const [city, setCity] = useState('')
  const [line1, setLine1] = useState('')
  const [persistStreet, setPersistStreet] = useState(false)

  // Detected districts from proxy geocoder
  const [detBusy, setDetBusy] = useState(false)
  const [detMsg, setDetMsg] = useState<string | null>(null)
  const [det, setDet] = useState<GeoResult>({ state: null, cd: null, sd: null, hd: null })

  const needsDistricts = useMemo(() => !addr.cd || !addr.sd || !addr.hd, [addr])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const { data: ures, error: uerr } = await supabase.auth.getUser()
        if (uerr || !ures.user) throw new Error('Please sign in.')
        const userId = ures.user.id

        const { data: a, error: aerr } = await (supabase as any)
          .from('user_addresses')
          .select('postal_code, state, city, line1, cd, sd, hd')
          .eq('user_id', userId)
          .eq('is_primary', true)
          .maybeSingle()
        if (aerr) throw new Error(aerr.message)

        if (!alive) return
        const next: AddressInfo = {
          postal_code: a?.postal_code ?? null,
          state: a?.state ?? null,
          city: a?.city ?? null,
          line1: a?.line1 ?? null,
          cd: a?.cd ?? null,
          sd: a?.sd ?? null,
          hd: a?.hd ?? null
        }
        setAddr(next)

        // Prefill inputs (ZIP only by default)
        setPostal(next.postal_code || '')
        setSt((next.state || '').toUpperCase())
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || 'Failed to load address.')
      } finally {
        if (!alive) return
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const handleDetect = async () => {
    setError(null)
    setOkMsg(null)
    try {
      if (!postal.trim()) throw new Error('Please enter your ZIP code.')
      setDetBusy(true)
      setDetMsg('Detecting your districts…')

      const r = await geocodeAddressViaServer({
        line1: line1 || null,
        city: city || null,
        state: st || null,
        postal_code: postal || null,
      })

      setDet(r)
      setDetMsg(`Found: ${r.state || st || '??'} • CD: ${r.cd || '—'} • SD: ${r.sd || '—'} • HD: ${r.hd || '—'}`)
    } catch (e: any) {
      setDetMsg(null)
      setError(e?.message || 'Detection failed.')
    } finally {
      setDetBusy(false)
    }
  }

  const handleSave = async () => {
    setError(null)
    setOkMsg(null)
    try {
      setSaving(true)
      const { data: ures, error: uerr } = await supabase.auth.getUser()
      if (uerr || !ures.user) throw new Error('Please sign in.')
      const userId = ures.user.id

      const state2 = (det.state || st || '').toUpperCase()
      if (!postal.trim()) throw new Error('ZIP is required.')
      if (!state2) throw new Error('Could not determine your state; please enter it.')

      // Save only districts by default (street optional)
      const payload: any = {
        user_id: userId,
        state: state2,
        cd: det.cd ?? null,
        sd: det.sd ?? null,
        hd: det.hd ?? null,
        postal_code: postal.trim(),
        persist_address: !!persistStreet
      }
      if (persistStreet) {
        payload.line1 = line1 || null
        payload.city = city || null
      }

      const resp = await fetch('/.netlify/functions/districts-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const j = await resp.json()
      if (!resp.ok) throw new Error(j?.error || 'Could not save districts.')

      // Remap user->reps locally for immediate UI consistency
      await assignRepsForCurrentUser()

      setOkMsg('Saved. Your representatives list has been updated.')
      // refresh visible snapshot
      setAddr(a => ({
        postal_code: postal || a.postal_code,
        state: state2 || a.state,
        city: persistStreet ? (city || null) : null,
        line1: persistStreet ? (line1 || null) : null,
        cd: det.cd ?? a.cd,
        sd: det.sd ?? a.sd,
        hd: det.hd ?? a.hd,
      }))
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const hasDetections = !!(det.state || det.cd || det.sd || det.hd)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Address (optional)</CardTitle>
        <CardDescription>
          To email your <span className="font-medium">state & federal</span> representatives, we need your districts.
          By default we only store your <span className="font-medium">ZIP, state, and districts</span> — not your street.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Current snapshot */}
        {!loading && (
          <div className="text-sm rounded-md border bg-gray-50 p-3">
            <div className="font-medium mb-1">Current on file</div>
            <div>ZIP: <span className="font-mono">{addr.postal_code || '—'}</span> • State: <span className="font-mono">{addr.state || '—'}</span></div>
            <div>CD: <span className="font-mono">{addr.cd || '—'}</span> • SD: <span className="font-mono">{addr.sd || '—'}</span> • HD: <span className="font-mono">{addr.hd || '—'}</span></div>
            {(addr.line1 || addr.city) && (
              <div className="text-xs text-gray-600 mt-1">Street on file: {addr.line1 || ''}{addr.city ? `, ${addr.city}` : ''}</div>
            )}
            {needsDistricts && (
              <div className="text-xs text-amber-700 mt-1">Tip: detect your districts below to improve accuracy.</div>
            )}
          </div>
        )}

        {/* Minimal input: ZIP (required), state (helps), optional street/city */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="addr-zip">ZIP (required)</Label>
            <Input id="addr-zip" inputMode="numeric" maxLength={10} value={postal} onChange={e => setPostal(e.target.value)} placeholder="e.g. 78701" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-state">State (2-letter)</Label>
            <Input id="addr-state" maxLength={2} value={st} onChange={e => setSt(e.target.value.toUpperCase())} placeholder="e.g. TX" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-line1">Street (optional)</Label>
            <Input id="addr-line1" value={line1} onChange={e => setLine1(e.target.value)} placeholder="123 Main St" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-city">City (optional)</Label>
            <Input id="addr-city" value={city} onChange={e => setCity(e.target.value)} placeholder="Austin" />
          </div>
        </div>

        {/* Privacy toggle for street persistence */}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={persistStreet} onChange={e => setPersistStreet(e.target.checked)} />
          Also save my street & city (optional). If unchecked, we only store ZIP/state/districts.
        </label>

        {/* Detect + Save controls */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={handleDetect} disabled={detBusy || saving}>
            {detBusy ? (detMsg || 'Detecting…') : 'Detect my districts'}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || detBusy}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {hasDetections && (
            <span className="text-xs text-gray-600">
              Detected → State: <span className="font-mono">{det.state || st || '—'}</span>,
              CD: <span className="font-mono">{det.cd || '—'}</span>,
              SD: <span className="font-mono">{det.sd || '—'}</span>,
              HD: <span className="font-mono">{det.hd || '—'}</span>
            </span>
          )}
        </div>

        {/* Notices */}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {okMsg && <p className="text-sm text-green-700">{okMsg}</p>}

        <p className="text-xs text-gray-500">
          We detect districts through a secure server proxy to the U.S. Census Geocoder. By default, only ZIP, state, and districts are stored.
          You can remove your street/city later — your districts will remain so the feature still works.
        </p>
      </CardContent>
    </Card>
  )
}
