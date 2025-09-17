// src/components/RepsSendModal.tsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { assignRepsForCurrentUser } from '@/lib/reps';
import { Button } from '@/components/ui/button';

/** Share targets */
const FEED_URL = 'https://cyberkingdomofchrist.netlify.app/feed';

/** Build X (Twitter) intent URL with text (and optional url param) */
function buildTweetUrlText(text: string, url?: string) {
  const params = new URLSearchParams({ text });
  if (url) params.set('url', url);
  return `https://x.com/intent/tweet?${params.toString()}`;
}

/** Build Facebook share dialog URL with optional quote and url */
function buildFacebookShareUrl(url?: string, quote?: string) {
  const params = new URLSearchParams();
  if (url) params.set('u', url);
  if (quote && quote.trim()) params.set('quote', quote.trim());
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type RepRowDB = {
  id: string;
  name: string | null;
  office_name: string | null;
  state: string | null;
  district: string | null;
  level: 'federal' | 'state' | 'local' | null;
};

type Rep = {
  id: string;
  name: string;
  office: string;
  state: string | null;
  district: string | null;
  level: 'federal' | 'state' | 'local';
};

type Props = { prayerId: string; onClose: () => void };

type AddressInfo = {
  postal_code: string | null;
  state: string | null;
  city?: string | null;
  line1?: string | null;
  cd?: string | null;
  sd?: string | null;
  hd?: string | null;
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

// ──────────────────────────────────────────────────────────────────────────────
export default function RepsSendModal({ prayerId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [reps, setReps] = useState<Rep[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keep for enrichment banner
  const [addr, setAddr] = useState<AddressInfo | null>(null);
  const needsDistricts = useMemo(() => {
    if (!addr) return false;
    return !addr.cd || !addr.sd || !addr.hd;
  }, [addr]);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

  // Prayer text to share (no email draft UI)
  const [prayerText, setPrayerText] = useState<string>('');

  // Level filter UI
  const [levelFilter, setLevelFilter] = useState<'all' | 'federal' | 'state'>('all');

  // Shared loader
  const loadAll = async () => {
    setLoading(true);
    setError(null);

    // Ensure user->rep mappings exist
    await assignRepsForCurrentUser();

    const { data: ures, error: uerr } = await supabase.auth.getUser();
    if (uerr || !ures.user) { throw new Error('Please sign in.'); }
    const userId = ures.user.id;

    // Primary address (for enrichment banner)
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

    // Mappings → ids
    const { data: mapRows, error: mapErr } = await supabase
      .from('user_representatives')
      .select('rep_id')
      .eq('user_id', userId);
    if (mapErr) throw new Error(mapErr.message);
    const ids = (mapRows ?? []).map(r => r.rep_id);

    // Representatives
    let list: Rep[] = [];
    if (ids.length) {
      const { data: repsRows, error: repsErr } = await (supabase as any)
        .from('representatives')
        .select('id, name, office_name, state, district, level, twitter_handle')
        .in('id', ids);
      if (repsErr) throw new Error(repsErr.message);

      list = ((repsRows as any[]) ?? []).map((r) => ({
        id: r.id,
        name: (r.name ?? 'Representative'),
        office: (r.office_name ?? 'Representative'),
        state: r.state ?? null,
        district: r.district ?? null,
        level: (r.level === 'federal' || r.level === 'state' || r.level === 'local')
          ? r.level
          : inferLevel(r.office_name),
        // twitter_handle may or may not exist; keep on the object if present
        ...(r.twitter_handle ? { twitter_handle: r.twitter_handle } : {}),
      }));
    }

    // Prayer content (used for share text)
    const { data: prayerRow, error: prayerErr } = await supabase
      .from('prayers')
      .select('content')
      .eq('id', prayerId)
      .maybeSingle();
    if (prayerErr) throw new Error(prayerErr.message);

    setReps(list);
    setPrayerText(String(prayerRow?.content || '').trim());
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

  const displayReps = useMemo(() => {
    if (levelFilter === 'all') return reps;
    return (reps ?? []).filter((r) => r.level === levelFilter);
  }, [reps, levelFilter]);

  const grouped = useMemo(() => {
    const g: Record<Rep['level'], Rep[]> = { federal: [], state: [], local: [] };
    for (const r of displayReps) g[r.level].push(r);
    return g;
  }, [displayReps]);

  // Enrichment flow (unchanged)
  const handleDetectDistricts = async () => {
    try {
      setEnrichBusy(true);
      setEnrichMsg('Detecting your districts…');

      const { data: ures, error: uerr } = await supabase.auth.getUser();
      if (uerr || !ures.user) throw new Error('Please sign in.');
      const userId = ures.user.id;

      const { data: a, error: aerr } = await (supabase as any)
        .from('user_addresses')
        .select('postal_code, state, city, line1, cd, sd, hd')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .maybeSingle();
      if (aerr) throw new Error(aerr.message);
      if (!a?.postal_code) throw new Error('Please add a ZIP code to your profile address.');

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

      setEnrichMsg('Syncing federal representatives…');
      const q1 = new URLSearchParams({ state: st });
      if (cd && cd !== 'At-Large') q1.set('house_district', String(cd));
      await fetch(`/.netlify/functions/reps-sync?${q1.toString()}`);

      if (sd || hd) {
        setEnrichMsg('Syncing state legislators…');
        const q2 = new URLSearchParams({ state: st });
        if (sd) q2.set('sd', String(sd));
        if (hd) q2.set('hd', String(hd));
        await fetch(`/.netlify/functions/state-reps-sync?${q2.toString()}`);
      }

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

  return (
    <div className="fixed inset-0 z-[9999] flex items-start sm:items-center justify-center overflow-y-auto p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-xl p-6 mx-auto my-6 md:my-10 max-h-[min(92svh,calc(100dvh-3rem))] overflow-y-auto">

        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-semibold">Share to Representatives</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">✕</button>
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

            <div className="border rounded-lg overflow-hidden">
              {(['federal','state'] as const).map(level => (
                <div key={level} className="border-b last:border-b-0">
                  <div className="bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase">{level}</div>
                  {(grouped[level] || []).map(r => (
                    <div key={r.id} className="flex items-start gap-3 px-3 py-2">
                      <div className="mt-1">•</div>
                      <div>
                        <div className="font-medium">{displayNameForRep(r)}</div>
                        <div className="text-xs text-gray-600">{r.office}</div>

                        {/* Per-rep share buttons */}
                        {(() => {
                          // Prefer @handle when available; fall back to label
                          const handle = (r as any)?.twitter_handle as string | undefined;
                          const mention = handle && handle.trim()
                            ? `@${handle.replace(/^@/, '').trim()}`
                            : displayNameForRep(r);

                          // Use actual prayer text; Twitter safely truncated to fit with mention
                          const draft = (prayerText || '').trim();
                          const rawTweet = draft ? `${mention}, ${draft}` : `${mention}, please consider this prayer.`;
                          const MAX = 260; // conservative headroom for link param
                          const tweetText = rawTweet.length > MAX ? (rawTweet.slice(0, MAX - 1) + '…') : rawTweet;

                          const tweetUrl = buildTweetUrlText(tweetText, FEED_URL);
                          const fbQuote  = draft || `Please consider this prayer. ${displayNameForRep(r)}`;
                          const fbUrl    = buildFacebookShareUrl(FEED_URL, fbQuote);

                          return (
                            <div className="mt-1 flex gap-2">
                              <a
                                href={tweetUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center rounded px-2 py-1 text-xs border"
                                title="Tweet (opens composer)"
                              >
                                Twitter (X)
                              </a>
                              <a
                                href={fbUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center rounded px-2 py-1 text-xs border"
                                title="Share on Facebook (opens share dialog)"
                              >
                                Facebook
                              </a>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <div className="mt-6 sticky bottom-0 bg-white pt-4 flex justify-end gap-2" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
