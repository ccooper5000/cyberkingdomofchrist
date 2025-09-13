// src/lib/outreach.ts

import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { assignRepsForCurrentUser } from '@/lib/reps';

type Tables = Database['public']['Tables'];
type OutreachRequestRow = Tables['outreach_requests']['Row'];
export type OutreachChannel = 'email' | 'x' | 'facebook';

function todayYMD() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function requeueFailedForToday(params: {
  userId: string;
  prayerId: string;
  repIds: string[];
  subject?: string | null;
  body?: string | null;
  channels: OutreachChannel[];
}) {
  if (!params.repIds.length) return { requeuedIds: [] as string[] };

  const { data: existing, error: existErr } = await supabase
    .from('outreach_requests')
    .select('id, target_rep_id, status')
    .eq('user_id', params.userId)
    .eq('prayer_id', params.prayerId)
    .eq('send_date', todayYMD())
    .in('target_rep_id', params.repIds);

  if (existErr) return { requeuedIds: [] as string[] };

  const toRequeue = (existing ?? []).filter(r => r.status === 'failed' || r.status === 'throttled');
  const toRequeueIds = toRequeue.map(r => r.id);

  if (toRequeueIds.length) {
    await supabase
      .from('outreach_requests')
      .update({
        status: 'queued',
        error: null,
        subject: params.subject ?? null,
        body: params.body ?? null,
        channels: params.channels,
      })
      .in('id', toRequeueIds);
  }

  return { requeuedIds: toRequeueIds };
}

async function findAlreadyHandledToday(params: {
  userId: string;
  prayerId: string;
  repIds: string[];
}) {
  if (!params.repIds.length) return new Set<string>();
  const { data } = await supabase
    .from('outreach_requests')
    .select('target_rep_id, status')
    .eq('user_id', params.userId)
    .eq('prayer_id', params.prayerId)
    .eq('send_date', todayYMD())
    .in('target_rep_id', params.repIds);

  // Treat queued/sent as already handled; failed/throttled may get requeued by caller.
  const skip = new Set<string>();
  for (const r of data ?? []) {
    if (r.status === 'queued' || r.status === 'sent') skip.add(r.target_rep_id as string);
  }
  return skip;
}

export const outreach = {
  /** Queue outreach for ALL mapped reps (only reps that have an email). Also requeues today's failed/throttled. */
  enqueueOutreach: async (opts: {
    userId: string;
    prayerId: string;
    channels: OutreachChannel[];
    subject?: string;
    body?: string;
  }): Promise<{ data: OutreachRequestRow[] | null; error: any }> => {
    try { await assignRepsForCurrentUser(); } catch { /* non-fatal */ }

    // Pull ONLY mapped reps that actually have an email
    const { data: reps, error: repsErr } = await supabase
      .from('user_representatives')
      .select('rep_id, representatives!inner(id,email)')
      .eq('user_id', opts.userId);

    if (repsErr) return { data: null, error: repsErr };

    const repIdsWithEmail = (reps ?? [])
      .filter((r: any) => r.representatives?.email)
      .map((r: any) => r.rep_id as string);

    // Requeue failed/throttled for today
    const { requeuedIds } = await requeueFailedForToday({
      userId: opts.userId,
      prayerId: opts.prayerId,
      repIds: repIdsWithEmail,
      subject: opts.subject ?? null,
      body: opts.body ?? null,
      channels: opts.channels,
    });

    // Skip reps that already have queued/sent today
    const skip = await findAlreadyHandledToday({
      userId: opts.userId,
      prayerId: opts.prayerId,
      repIds: repIdsWithEmail,
    });

    const toInsertRepIds = repIdsWithEmail.filter(id => !skip.has(id));

    const rows: any[] = toInsertRepIds.map((repId) => ({
      user_id: opts.userId,
      prayer_id: opts.prayerId,
      target_rep_id: repId,
      channels: opts.channels,
      status: 'queued',
      subject: opts.subject ?? null,
      body: opts.body ?? null,
      // send_date is assumed to default to current_date in DB; not set here.
    }));

    let inserted: OutreachRequestRow[] = [];
    if (rows.length) {
      const { data, error } = await supabase
        .from('outreach_requests')
        .upsert(rows, {
          onConflict: 'user_id, target_rep_id, prayer_id, send_date',
          ignoreDuplicates: true,
        })
        .select('*');
      if (error) return { data: null, error };
      inserted = (data ?? []) as OutreachRequestRow[];
    }

    // If we requeued but inserted nothing new, return the requeued rows so the UI doesn’t show “already queued”
    let requeuedRows: OutreachRequestRow[] = [];
    if (requeuedIds.length) {
      const { data } = await supabase
        .from('outreach_requests')
        .select('*')
        .in('id', requeuedIds);
      requeuedRows = (data ?? []) as OutreachRequestRow[];
    }

    return { data: [...requeuedRows, ...inserted], error: null };
  },

  /** Queue outreach for a SELECTED subset (only those that have an email). Also requeues today's failed/throttled. */
  enqueueOutreachToSelected: async (opts: {
    userId: string;
    prayerId: string;
    repIds: string[];
    channels: OutreachChannel[];
    subject?: string;
    body?: string;
  }): Promise<{ data: OutreachRequestRow[] | null; error: any }> => {
    if (!opts.repIds.length) return { data: [], error: null };

    // Constrain to reps that are mapped to this user AND have an email
    const { data: reps, error: repsErr } = await supabase
      .from('user_representatives')
      .select('rep_id, representatives!inner(id,email)')
      .eq('user_id', opts.userId)
      .in('rep_id', opts.repIds);

    if (repsErr) return { data: null, error: repsErr };

    const repIdsWithEmail = (reps ?? [])
      .filter((r: any) => r.representatives?.email)
      .map((r: any) => r.rep_id as string);

    // Requeue failed/throttled for today
    const { requeuedIds } = await requeueFailedForToday({
      userId: opts.userId,
      prayerId: opts.prayerId,
      repIds: repIdsWithEmail,
      subject: opts.subject ?? null,
      body: opts.body ?? null,
      channels: opts.channels,
    });

    // Skip reps that already have queued/sent today
    const skip = await findAlreadyHandledToday({
      userId: opts.userId,
      prayerId: opts.prayerId,
      repIds: repIdsWithEmail,
    });

    const toInsertRepIds = repIdsWithEmail.filter(id => !skip.has(id));

    const rows: any[] = toInsertRepIds.map((repId) => ({
      user_id: opts.userId,
      prayer_id: opts.prayerId,
      target_rep_id: repId,
      channels: opts.channels,
      status: 'queued',
      subject: opts.subject ?? null,
      body: opts.body ?? null,
    }));

    let inserted: OutreachRequestRow[] = [];
    if (rows.length) {
      const { data, error } = await supabase
        .from('outreach_requests')
        .upsert(rows, {
          onConflict: 'user_id, target_rep_id, prayer_id, send_date',
          ignoreDuplicates: true,
        })
        .select('*');
      if (error) return { data: null, error };
      inserted = (data ?? []) as OutreachRequestRow[];
    }

    let requeuedRows: OutreachRequestRow[] = [];
    if (requeuedIds.length) {
      const { data } = await supabase
        .from('outreach_requests')
        .select('*')
        .in('id', requeuedIds);
      requeuedRows = (data ?? []) as OutreachRequestRow[];
    }

    return { data: [...requeuedRows, ...inserted], error: null };
  },

  /** Queue outreach to the President (only if email exists). Also requeues today's failed/throttled. */
  enqueueToPresident: async (opts: {
    userId: string;
    prayerId: string;
    channels: OutreachChannel[];
    subject?: string;
    body?: string;
  }): Promise<{ data: OutreachRequestRow[] | null; error: any }> => {
    const { data: presRows, error: presErr } = await supabase
      .from('representatives')
      .select('id,email,name,office_name')
      .or('office_name.ilike.%president%,name.ilike.%president%')
      .limit(3);

    if (presErr) return { data: null, error: presErr };

    const repIdsWithEmail = (presRows ?? [])
      .filter((p: any) => p.email)
      .map((p: any) => p.id as string);

    // Requeue failed/throttled for today
    const { requeuedIds } = await requeueFailedForToday({
      userId: opts.userId,
      prayerId: opts.prayerId,
      repIds: repIdsWithEmail,
      subject: opts.subject ?? null,
      body: opts.body ?? null,
      channels: opts.channels,
    });

    // Skip reps that already have queued/sent today
    const skip = await findAlreadyHandledToday({
      userId: opts.userId,
      prayerId: opts.prayerId,
      repIds: repIdsWithEmail,
    });

    const toInsertRepIds = repIdsWithEmail.filter(id => !skip.has(id));

    const rows: any[] = toInsertRepIds.map((repId) => ({
      user_id: opts.userId,
      prayer_id: opts.prayerId,
      target_rep_id: repId,
      channels: opts.channels,
      status: 'queued',
      subject: opts.subject ?? null,
      body: opts.body ?? null,
    }));

    let inserted: OutreachRequestRow[] = [];
    if (rows.length) {
      const { data, error } = await supabase
        .from('outreach_requests')
        .upsert(rows, {
          onConflict: 'user_id, target_rep_id, prayer_id, send_date',
          ignoreDuplicates: true,
        })
        .select('*');
      if (error) return { data: null, error };
      inserted = (data ?? []) as OutreachRequestRow[];
    }

    let requeuedRows: OutreachRequestRow[] = [];
    if (requeuedIds.length) {
      const { data } = await supabase
        .from('outreach_requests')
        .select('*')
        .in('id', requeuedIds);
      requeuedRows = (data ?? []) as OutreachRequestRow[];
    }

    return { data: [...requeuedRows, ...inserted], error: null };
  },

  /** List a user’s queued/sent outreach requests (most recent first). */
  getUserOutreachRequests: async (userId: string) => {
    const { data, error } = await supabase
      .from('outreach_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    return { data: data as OutreachRequestRow[] | null, error };
  },

  /** Simple analytics for a single prayer’s outreach requests. */
  getPrayerOutreachAnalytics: async (prayerId: string) => {
    const { data, error } = await supabase
      .from('outreach_requests')
      .select('status, channels')
      .eq('prayer_id', prayerId);

    if (error) return { data: null, error };

    const stats = {
      total: 0,
      queued: 0,
      sent: 0,
      failed: 0,
      throttled: 0,
      channels: { email: 0, x: 0, facebook: 0 } as Record<OutreachChannel, number>,
    };

    for (const row of data ?? []) {
      stats.total += 1;
      if (row.status === 'queued') stats.queued += 1;
      if (row.status === 'sent') stats.sent += 1;
      if (row.status === 'failed') stats.failed += 1;
      if (row.status === 'throttled') stats.throttled += 1;
      for (const ch of row.channels as OutreachChannel[]) {
        if (ch in stats.channels) stats.channels[ch] += 1;
      }
    }
    return { data: stats, error: null };
  },

  /** Server hook to mark requests as sent (Netlify function). */
  markOutreachSent: async (ids: string[]) => {
    const res = await fetch('/.netlify/functions/outreach-processor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_sent', ids }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: json?.error || `HTTP ${res.status}` };
    return { data: json, error: null };
  },

  /** (Kept) Community invite passthrough. */
  inviteToGroup: async (groupId: string, inviteeEmail: string, inviterId: string) => {
    const response = await fetch('/.netlify/functions/outreach-processor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'group_invitation', groupId, inviteeEmail, inviterId }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return { data: null, error: json?.error || `HTTP ${response.status}` };
    return { data: json, error: null };
  },
};
// ────────────────────────────────────────────────────────────────────────────
// APPEND: deliver a single queued outreach for a given prayer (user-authenticated)
// Requires the server-side `deliver_single` action we just added.
// ────────────────────────────────────────────────────────────────────────────

export async function deliverSingleByPrayerId(prayerId: string) {
  if (!prayerId) throw new Error('Missing prayerId');

  // Get the user’s JWT (supabase-js v2)
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not signed in');

  const res = await fetch('/.netlify/functions/outreach-processor', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'deliver_single', prayer_id: prayerId }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    throw new Error(json?.error || 'Send failed');
  }
  return json as {
    ok: true;
    used_stream: string;
    used_template_alias: string | null;
    detail: { request_id: string; status: 'sent' | 'failed'; message_id?: string; error?: string };
  };
}


