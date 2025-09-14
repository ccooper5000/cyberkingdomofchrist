// src/components/RepsSendModal.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { assignRepsForCurrentUser } from '@/lib/reps';
import { outreach, type OutreachChannel, deliverSingleByPrayerId } from '@/lib/outreach';
import { Button } from '@/components/ui/button';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

// DB row shape we read directly (real column names)
type RepRowDB = {
  id: string;
  name: string | null;
  office_name: string | null;
  state: string | null;
  district: string | null;
  level: 'federal' | 'state' | 'local' | null;
};

// Local shape used by the UI (what the JSX renders)
type Rep = {
  id: string;
  name: string;     // plain name
  office: string;   // "U.S. Senator", "U.S. Representative", "State Senator", "State Representative"
  state: string | null;
  district: string | null; // "21" etc. (label formatter will add "TX-21")
  level: 'federal' | 'state' | 'local';
};

type Tier = 'free' | 'supporter' | 'patron' | 'admin';
type Props = { prayerId: string; onClose: () => void };

// Primary address snapshot for prompts
type AddressInfo = {
  postal_code: string | null;
  state: string | null;
  city?: string | null;
  line1?: string | null;
  cd?: string | null;  // congressional
  sd?: string | null;  // state senate (upper)
  hd?: string | null;  // state house (lower)
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function normalizeOffice(office: string | null): string {
  return (office || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function inferLevel(office: string | null): Rep['level'] {
  const o = normalizeOffice(office);
  if (
    (o.includes('united states') && (o.includes('senate') || o.includes('senator') || o.includes('house') || o.includes('representative') || o.includes('congress'))) ||
    o.includes('us senate') || o.includes('u s senate') ||
    o.includes('us senator') || o.includes('u s senator') ||
    o.includes('us house')   || o.includes('u s house')   ||
    o.includes('us representative') || o.includes('u s representative') ||
    o.includes('president') || o.includes('white house')
  ) return 'federal';
  if (
    o.includes('state senator') || o.includes('state senate') ||
    o.includes('state representative') || o.includes('state house') ||
    o.includes('state assembly') || o.includes('general assembly') ||
    o.includes('legislature') || o.includes('texas senate') || o.includes('texas house')
  ) return 'state';
  return 'local';
}
function titleForRep(office: string | null): 'Sen.' | 'Rep.' | 'President' | 'Hon.' {
  const o = normalizeOffice(office);
  if (o.includes('president')) return 'President';
  if (o.includes('senate') || o.includes('senator')) return 'Sen.';
  if (o.includes('house') || o.includes('representative') || o.includes('congress')) return 'Rep.';
  return 'Hon.';
}
function lastNameFrom(name: string): string {
  const raw = name.replace(/[.,]/g, ' ').trim();
  const parts = raw.split(/\s+/);
  const suffixes = new Set(['jr','jr.','sr','sr.','ii','iii','iv','phd','m.d.','md','esq','esq.']);
  while (parts.length && suffixes.has(parts[parts.length-1].toLowerCase())) parts.pop();
  return parts.length ? parts[parts.length - 1] : name.trim();
}
function greetingForRep(rep: Pick<Rep, 'name' | 'office'>): string {
  const t = titleForRep(rep.office);
  const last = lastNameFrom(rep.name);
  return `Dear ${t} ${last},`;
}
/** Label formatting:
 *  - Federal: "[Title.] [Name]-[STATE]"  e.g., "Sen. Jane Sample-TX"
 *  - State:   "[Title.] [Name], [STATE]-[DIST]" e.g., "Sen. Jane Sample, TX-21"
 */
function displayNameForRep(rep: Rep): string {
  const t = titleForRep(rep.office);
  const name = rep.name;
  const st = rep.state ?? '';
  if (rep.level === 'federal') return `${t} ${name}-${st}`;
  if (rep.level === 'state') {
    const num = rep.district?.match(/\d+/)?.[0];
    return num ? `${t} ${name}, ${st}-${num}` : `${t} ${name}, ${st}`;
  }
  return `${t} ${name}${st ? `, ${st}` : ''}`;
}
function capForTier(tier: Tier | null): number {
  switch (tier) {
    case 'supporter': return 10;
    case 'patron': return 20;
    case 'admin': return 1000;
    default: return 5; // free
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────
export default function RepsSendModal({ prayerId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [reps, setReps] = useState<Rep[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [channels, setChannels] = useState<Record<OutreachChannel, boolean>>({ email: true, x: false, facebook: false });
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>(''); // server will prepend greeting per recipient
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tier & quota UI
  const [tier, setTier] = useState<Tier>('free');
  const [dailyCap, setDailyCap] = useState<number>(5);
  const [usedToday, setUsedToday] = useState<number>(0);

  // Level filter UI
  const [levelFilter, setLevelFilter] = useState<'all' | 'federal' | 'state'>('all');

  // Address prompt state
  const [addr, setAddr] = useState<AddressInfo | null>(null);
  const needsDistricts = useMemo(() => {
    if (!addr) return false;
    // We consider it "needing" if any of the three is missing
    return !addr.cd || !addr.sd || !addr.hd;
  }, [addr]);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

  // Shared loader so we can refresh after enrichment
  const loadAll = async () => {
    setLoading(true);
    setError(null);

    // Ensure user->rep mappings exist based on their address
    await assignRepsForCurrentUser();

    const { data: ures, error: uerr } = await supabase.auth.getUser();
    if (uerr || !ures.user) { throw new Error('Please sign in.'); }
    const userId = ures.user.id;

    // Fetch primary address (for prompt & enrichment params)
    {
      const { data: a, error: aerr } = await (supabase as any)
        .from('user_addresses')
        .select('postal_code, state, city, line1, cd, sd, hd')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .maybeSingle();
      if (aerr) throw new Error(aerr.message);
      setAddr({
        postal_code: a?.postal_code ?? null,
        state: a?.state ?? null,
        city: a?.city ?? null,
        line1: a?.line1 ?? null,
        cd: a?.cd ?? null,
        sd: a?.sd ?? null,
        hd: a?.hd ?? null,
      });
    }

    // Fetch mapping → ids
    const { data: mapRows, error: mapErr } = await supabase
      .from('user_representatives')
      .select('rep_id')
      .eq('user_id', userId);
    if (mapErr) throw new Error(mapErr.message);
    const ids = (mapRows ?? []).map(r => r.rep_id);

    // Fetch reps
    let list: Rep[] = [];
    if (ids.length) {
      const { data: repsRows, error: repsErr } = await (supabase as any)
        .from('representatives')
        .select('id, name, office_name, state, district, level')
        .in('id', ids);
      if (repsErr) throw new Error(repsErr.message);

      list = ((repsRows as RepRowDB[]) ?? []).map(r => ({
        id: r.id,
        name: (r.name ?? 'Representative'),
        office: (r.office_name ?? 'Representative'),
        state: r.state ?? null,
        district: r.district ?? null,
        level: (r.level === 'federal' || r.level === 'state' || r.level === 'local')
          ? r.level
          : inferLevel(r.office_name),
      }));
    }

    // Prayer content for body
    const { data: prayerRow, error: prayerErr } = await supabase
      .from('prayers')
      .select('content')
      .eq('id', prayerId)
      .maybeSingle();
    if (prayerErr) throw new Error(prayerErr.message);

    // Profile (for sender + tier)
    const { data: prof, error: profErr } = await supabase
      .from('profiles')
      .select('display_name, username, tier')
      .eq('id', userId)
      .maybeSingle();
    if (profErr) throw new Error(profErr.message);

    const sender = String(prof?.display_name || prof?.username || 'CKoC Member');

    // profiles.tier is a string in your types; narrow to our Tier union safely
    const rawTier = (prof?.tier ?? 'free') as string;
    const normalizedTier = (['free', 'supporter', 'patron', 'admin'] as const).includes(rawTier as Tier)
      ? (rawTier as Tier)
      : 'free';
    const cap = capForTier(normalizedTier);

    // Used today (server counts by send_date, which is UTC)
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const { count: usedCnt, error: countErr } = await supabase
      .from('outreach_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('send_date', today);
    if (countErr) throw new Error(countErr.message);

    const defaultSubject = `Message from a Cyber Kingdom of Christ user: ${sender}`;
    const defaultBody =
`${prayerRow?.content || '(prayer content)'}
    
Sincerely,
${sender}
CyberKingdomOfChrist.org`;

    // default-select all that we loaded
    const defSel: Record<string, boolean> = {};
    for (const r of list) defSel[r.id] = true;

    setReps(list);
    setSelected(defSel);
    setSubject(defaultSubject);
    setBody(defaultBody);
    setTier(normalizedTier);
    setDailyCap(cap);
    setUsedToday(usedCnt ?? 0);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await loadAll();
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'Failed to load data.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [prayerId]);

  // Filtered list for display (All / Federal / State)
  const displayReps = useMemo(() => {
    if (levelFilter === 'all') return reps;
    return (reps ?? []).filter((r) => r.level === levelFilter);
  }, [reps, levelFilter]);

  // Group by level for the UI sections
  const grouped = useMemo(() => {
    const g: Record<Rep['level'], Rep[]> = { federal: [], state: [], local: [] };
    for (const r of displayReps) g[r.level].push(r);
    return g;
  }, [displayReps]);

  const selectedReps = useMemo(() => reps.filter(r => selected[r.id]), [reps, selected]);
  const greetingPreview = useMemo(() => selectedReps.slice(0, 3).map(r => greetingForRep(r)), [selectedReps]);

  const remaining = Math.max(0, dailyCap - usedToday);
  const selectedCount = selectedReps.length;
  const overCap = selectedCount > remaining;

  const toggleRep = (id: string) => setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleChannel = (ch: OutreachChannel) => { if (ch === 'email') setChannels(prev => ({ ...prev, email: !prev.email })); };

  // Gentle address/district enrichment
  const handleDetectDistricts = async () => {
    try {
      setEnrichBusy(true);
      setEnrichMsg('Detecting your districts…');

      const { data: ures, error: uerr } = await supabase.auth.getUser();
      if (uerr || !ures.user) throw new Error('Please sign in.');
      const userId = ures.user.id;

      // Pull current address (to send to geocoder)
      const { data: a, error: aerr } = await (supabase as any)
        .from('user_addresses')
        .select('postal_code, state, city, line1, cd, sd, hd')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .maybeSingle();
      if (aerr) throw new Error(aerr.message);
      if (!a?.postal_code) throw new Error('Please add a ZIP code to your profile address.');

      // 1) Enrich via Census Geocoder (server function updates user_addresses)
      const geoRes = await fetch('/.netlify/functions/geo-enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          line1: a?.line1 ?? undefined,
          city: a?.city ?? undefined,
          state: a?.state ?? undefined,
          postal_code: a?.postal_code,
        }),
      });
      const gj = await geoRes.json();
      if (!geoRes.ok) throw new Error(gj?.error || 'Geocoder enrichment failed.');
      const st = String(gj?.state || a?.state || '').toUpperCase();
      const cd = gj?.cd || a?.cd || null;
      const sd = gj?.sd || a?.sd || null;
      const hd = gj?.hd || a?.hd || null;

      // 2) Seed federal reps (state + optional House district)
      setEnrichMsg('Syncing federal representatives…');
      const q1 = new URLSearchParams({ state: st });
      if (cd && cd !== 'At-Large') q1.set('house_district', String(cd));
      await fetch(`/.netlify/functions/reps-sync?${q1.toString()}`);

      // 3) Seed state legislators (sd/hd if present)
      if (sd || hd) {
        setEnrichMsg('Syncing state legislators…');
        const q2 = new URLSearchParams({ state: st });
        if (sd) q2.set('sd', String(sd));
        if (hd) q2.set('hd', String(hd));
        await fetch(`/.netlify/functions/state-reps-sync?${q2.toString()}`);
      }

      // 4) Map user → representatives and refresh modal list
      setEnrichMsg('Finalizing…');
      await assignRepsForCurrentUser();
      await loadAll();

      setEnrichMsg(null);
      setEnrichBusy(false);
    } catch (e: any) {
      setEnrichMsg(null);
      setEnrichBusy(false);
      setError(e?.message || 'District detection failed.');
    }
  };

  const handleSend = async () => {
    setError(null);
    if (!selectedCount) return setError('Select at least one representative.');
    if (!channels.email) return setError('Select at least one channel.');
    if (overCap) {
      return setError(`You can send to ${remaining} more recipient(s) today (daily cap ${dailyCap}). Deselect some recipients.`);
    }

    try {
      setBusy(true);
      const { data: ures } = await supabase.auth.getUser();
      const userId = ures.user!.id;

      const repIds = selectedReps.map(r => r.id);
      const res = await outreach.enqueueOutreachToSelected({
        userId,
        prayerId,
        repIds,
        channels: ['email'],
        subject,
        body,
      });
      await deliverSingleByPrayerId(prayerId);

      setBusy(false);
      if (res.error) {
        const msg = String(res.error.message || '');
        if (msg.includes('Daily outreach limit')) {
          setError('You’ve reached your daily outreach limit. Try again tomorrow.');
        } else {
          setError(res.error.message || 'Failed to enqueue outreach.');
        }
        return;
      }
      if (!res.data || res.data.length === 0) {
        alert('Already queued for all selected recipients today.');
        onClose();
        return;
      }
      alert(`Queued ${res.data.length} recipient(s).`);
      onClose();
    } catch (e: any) {
      setBusy(false);
      setError(e?.message || 'Unexpected error.');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center overflow-y-auto p-4">

      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-xl p-6 mx-auto my-6 md:my-10 max-h-[min(92svh,calc(100dvh-3rem))] overflow-y-auto">

        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-semibold">Send to Representatives</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">✕</button>
        </div>

        {/* Tier banner */}
        <div className="mb-4 rounded-md border bg-gray-50 p-3 text-sm">
          <div><span className="font-semibold capitalize">{tier}</span> tier • Daily cap: <span className="font-semibold">{dailyCap}</span></div>
          <div>Used today: <span className="font-semibold">{usedToday}</span> • Remaining: <span className="font-semibold">{Math.max(0, dailyCap - usedToday)}</span></div>
        </div>

        {/* Gentle address prompt */}
        {(!loading && (needsDistricts || reps.length === 0)) && (
          <div className="mb-4 rounded-md border p-3 bg-amber-50 text-sm">
            <div className="font-medium">Improve accuracy with your address</div>
            <div className="text-xs mt-1">
              We {addr?.cd ? '' : 'don’t know your congressional district'}
              {(!addr?.cd && (!addr?.sd || !addr?.hd)) ? ', ' : ''}
              {!addr?.sd || !addr?.hd ? 'and state legislative districts' : ''}
              . Click the button below to detect your districts from your address/ZIP.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={handleDetectDistricts} disabled={enrichBusy}>
                {enrichBusy ? (enrichMsg || 'Detecting…') : 'Detect my districts'}
              </Button>
              {addr?.postal_code && (
                <span className="text-xs text-gray-600">Using ZIP: {addr.postal_code}{addr.state ? ` • State: ${addr.state}` : ''}</span>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-600">Loading…</p>
        ) : reps.length === 0 ? (
          <p className="text-sm text-gray-600">No representatives mapped for your address yet.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: recipients + channels */}
            <div>
              {/* Level filter */}
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm font-medium">Level:</span>
                <button
                  type="button"
                  onClick={() => setLevelFilter('all')}
                  aria-pressed={levelFilter === 'all'}
                  className={`px-2 py-1 rounded ${levelFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setLevelFilter('federal')}
                  aria-pressed={levelFilter === 'federal'}
                  className={`px-2 py-1 rounded ${levelFilter === 'federal' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
                >
                  Federal
                </button>
                <button
                  type="button"
                  onClick={() => setLevelFilter('state')}
                  aria-pressed={levelFilter === 'state'}
                  className={`px-2 py-1 rounded ${levelFilter === 'state' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
                >
                  State
                </button>
              </div>

              <div className="mb-3">
                <div className="text-sm font-medium mb-2">Recipients</div>
                <div className="border rounded-lg overflow-hidden">
                  {(['federal','state','local'] as const).map(level => (
                    <div key={level} className="border-b last:border-b-0">
                      <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase">{level}</div>
                      {(grouped[level] || []).map(r => (
                        <label key={r.id} className="flex items-start gap-3 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!!selected[r.id]}
                            onChange={() => setSelected(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                            className="mt-1"
                          />
                          <div>
                            <div className="font-medium">{displayNameForRep(r)}</div>
                            <div className="text-xs text-gray-600">{r.office}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                {overCap && (
                  <p className="text-xs text-red-600 mt-2">
                    You’ve selected {selectedCount} recipients but only {Math.max(0, dailyCap - usedToday)} send(s) remain today.
                  </p>
                )}
              </div>

              <div className="mb-3">
                <div className="text-sm font-medium mb-2">Channels</div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={channels.email} onChange={() => toggleChannel('email')} />
                    <span>Email</span>
                  </label>
                  <label className="flex items-center gap-2 opacity-50 cursor-not-allowed" title="Tier-locked">
                    <input type="checkbox" checked={channels.x} disabled />
                    <span>X (Twitter)</span>
                  </label>
                  <label className="flex items-center gap-2 opacity-50 cursor-not-allowed" title="Tier-locked">
                    <input type="checkbox" checked={channels.facebook} disabled />
                    <span>Facebook</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Right: draft/review */}
            <div>
              <div className="text-sm font-medium mb-2">Draft (Email)</div>
              <div className="space-y-2">
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full border rounded-md px-3 py-2" placeholder="Subject" maxLength={180} />
                {selectedReps.length > 0 && (
                  <div className="rounded-md border p-3 bg-gray-50 text-xs text-gray-700">
                    <div className="font-semibold mb-1">Greeting preview (per recipient):</div>
                    <ul className="list-disc ml-5 space-y-0.5">
                      {greetingPreview.map((g, i) => (<li key={i}>{g}</li>))}
                      {selectedReps.length > greetingPreview.length && (<li>…and {selectedReps.length - greetingPreview.length} more</li>)}
                    </ul>
                    <div className="mt-2">The server will prepend the correct greeting for each recipient.</div>
                  </div>
                )}
                <textarea value={body} onChange={(e) => setBody(e.target.value)} className="w-full border rounded-md px-3 py-2 min-h-[180px]" placeholder="Body (greeting added per recipient on send)" />
                <p className="text-xs text-gray-500">Delivery happens server-side.</p>
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <div
  className="mt-6 sticky bottom-0 bg-white pt-4 flex justify-end gap-2"
  style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
>

          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSend} disabled={busy || loading || reps.length === 0 || overCap || enrichBusy}>
            {busy ? 'Queuing…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
