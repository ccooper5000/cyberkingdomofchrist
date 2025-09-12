// netlify/functions/notifications-processor.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { renderEmailHTML } from '../lib/email-template'

// ────────────────────────────────────────────────────────────────────────────
// ENV
// ────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const POSTMARK_SERVER_TOKEN = (process.env.POSTMARK_SERVER_TOKEN || '').trim()
const EMAIL_FROM = (process.env.EMAIL_FROM || '').trim()
const EMAIL_FROM_NAME = (process.env.EMAIL_FROM_NAME || 'Cyber Kingdom of Christ').trim()
const POSTMARK_NOTIF_STREAM = (process.env.POSTMARK_NOTIF_STREAM || 'outbound').trim()
const SITE_URL = (process.env.SITE_URL || 'https://cyberkingdomofchrist.netlify.app').trim()
const ADMIN_SECRET = process.env.CKOC_ADMIN_SECRET

// Anti-abuse knobs
const REPLY_COOLDOWN_MINUTES = Number(process.env.REPLY_NOTIFY_COOLDOWN_MINUTES || 30) // per actor->prayer
const MAX_REPLY_EMAILS_PER_HOUR_PER_RECIPIENT = Number(process.env.MAX_REPLY_EMAILS_PER_HOUR_PER_RECIPIENT || 10)
const BATCH_LIMIT = Number(process.env.NOTIF_BATCH_LIMIT || 50)

// ────────────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ────────────────────────────────────────────────────────────────────────────
// Postmark helpers
// ────────────────────────────────────────────────────────────────────────────
type PostmarkSendResponse = {
  To: string; SubmittedAt: string; MessageID: string; ErrorCode: number; Message: string
}

async function postmarkFetch(path: string, payload: Record<string, any>): Promise<PostmarkSendResponse> {
  const res = await fetch(`https://api.postmarkapp.com${path}`, {
    method: 'POST',
    headers: { 'X-Postmark-Server-Token': POSTMARK_SERVER_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = (await res.json().catch(() => ({}))) as Partial<PostmarkSendResponse> & { Message?: string; ErrorCode?: number }
  const ok = res.ok && (json?.ErrorCode ?? 0) === 0
  if (!ok) throw new Error(json?.Message || `HTTP ${res.status}`)
  return json as PostmarkSendResponse
}

async function sendWithPostmark(params: { to: string; subject: string; html?: string | null; text?: string | null }) {
  const From = EMAIL_FROM_NAME ? `${EMAIL_FROM_NAME} <${EMAIL_FROM}>` : EMAIL_FROM
  return postmarkFetch('/email', {
    From, To: params.to, Subject: params.subject,
    HtmlBody: params.html || undefined, TextBody: params.text || undefined,
    MessageStream: POSTMARK_NOTIF_STREAM,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Data helpers
// ────────────────────────────────────────────────────────────────────────────
async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (!error && data?.user?.email) return data.user.email
  } catch {}
  return null
}

async function getDisplayName(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, username, first_name, last_name')
      .eq('id', userId)
      .maybeSingle()
    const d = (data as any) || {}
    return d.display_name || [d.first_name, d.last_name].filter(Boolean).join(' ') || d.username || 'Someone'
  } catch { return 'Someone' }
}

type OutboxRow = {
  id: string; event_type: 'prayer_like' | 'prayer_reply';
  actor_user_id: string; target_user_id: string; prayer_id: string; comment_id: string | null;
  payload: any; created_at: string
}

async function fetchQueued(limit: number): Promise<OutboxRow[]> {
  const { data, error } = await supabase
    .from('notification_outbox')
    .select('id, event_type, actor_user_id, target_user_id, prayer_id, comment_id, payload, created_at')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as OutboxRow[]
}

async function markProcessed(id: string, status: 'sent' | 'skipped' | 'throttled' | 'failed', error?: string | null) {
  await supabase.from('notification_outbox').update({
    status, processed_at: new Date().toISOString(), error: error || null
  }).eq('id', id)
}

async function recordSend(row: OutboxRow, throttleKey?: string | null) {
  await supabase.from('notification_sends').insert({
    outbox_id: row.id, event_type: row.event_type,
    actor_user_id: row.actor_user_id, target_user_id: row.target_user_id,
    prayer_id: row.prayer_id, comment_id: row.comment_id, throttle_key: throttleKey || null,
  })
}

async function countRecentReplyEmailsToRecipient(recipientId: string, withinMinutes: number): Promise<number> {
  const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('notification_sends')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'prayer_reply')
    .eq('target_user_id', recipientId)
    .gte('sent_at', since)
  return count || 0
}

// ────────────────────────────────────────────────────────────────────────────
// Compose + send
// ────────────────────────────────────────────────────────────────────────────
async function handleLike(row: OutboxRow) {
  const toEmail = await getUserEmail(row.target_user_id)
  if (!toEmail) return markProcessed(row.id, 'skipped', 'No recipient email')

  const actorName = await getDisplayName(row.actor_user_id)
  const subject = `${actorName} liked your prayer`
  const body = renderEmailHTML({
    subject, greeting: `Hi,`,
    body: `${actorName} just liked your prayer.\n\nOpen your prayer here:\n${SITE_URL}/feed`,
  })

  try {
    await sendWithPostmark({ to: toEmail, subject, html: body })
    await recordSend(row, `like:${row.actor_user_id}:${row.prayer_id}`)
    await markProcessed(row.id, 'sent')
  } catch (err: any) {
    await markProcessed(row.id, 'failed', err?.message || 'Send failed')
  }
}

function minuteBucket(d = new Date(), size = REPLY_COOLDOWN_MINUTES) {
  const ms = d.getTime(), bucketMs = size * 60 * 1000
  return new Date(Math.floor(ms / bucketMs) * bucketMs).toISOString().slice(0,16) // yyyy-mm-ddThh:mm
}

async function handleReply(row: OutboxRow) {
  const toEmail = await getUserEmail(row.target_user_id)
  if (!toEmail) return markProcessed(row.id, 'skipped', 'No recipient email')

  // Global per-recipient cap for reply notifications (anti-abuse)
  const recent = await countRecentReplyEmailsToRecipient(row.target_user_id, 60)
  if (recent >= MAX_REPLY_EMAILS_PER_HOUR_PER_RECIPIENT) {
    return markProcessed(row.id, 'throttled', 'Recipient hourly cap reached')
  }

  // Per actor->prayer cooldown
  const bucket = minuteBucket()
  const throttleKey = `reply:${row.actor_user_id}:${row.prayer_id}:${bucket}`
  const { error: insErr } = await supabase.from('notification_sends').insert({
    outbox_id: row.id, event_type: row.event_type,
    actor_user_id: row.actor_user_id, target_user_id: row.target_user_id,
    prayer_id: row.prayer_id, comment_id: row.comment_id, throttle_key: throttleKey,
  })
  if (insErr) {
    const msg = String(insErr.message || '')
    if (msg.includes('uq_notification_sends_throttle')) return markProcessed(row.id, 'throttled', 'Cooldown in effect')
    return markProcessed(row.id, 'failed', `Ledger insert failed: ${insErr.message}`)
  }

  const actorName = await getDisplayName(row.actor_user_id)
  const preview = (row.payload?.preview as string | undefined) || ''
  const subject = `${actorName} replied to your prayer`
  const body = renderEmailHTML({
    subject, greeting: `Hi,`,
    body: `${actorName} just replied to your prayer:\n\n“${preview}”\n\nOpen the discussion:\n${SITE_URL}/feed`,
  })

  try {
    await sendWithPostmark({ to: toEmail, subject, html: body })
    await markProcessed(row.id, 'sent')
  } catch (err: any) {
    await markProcessed(row.id, 'failed', err?.message || 'Send failed')
  }
}

async function deliverQueued() {
  const rows = await fetchQueued(BATCH_LIMIT)
  for (const row of rows) {
    if (row.event_type === 'prayer_like') await handleLike(row)
    else if (row.event_type === 'prayer_reply') await handleReply(row)
    else await markProcessed(row.id, 'skipped', 'Unknown event type')
  }
  return { processed: rows.length }
}

// ────────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────────
export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-ckoc-admin, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod === 'GET') {
    const result = await deliverQueued()
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...result }) }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const payload = JSON.parse(event.body || '{}')
    const adminHeader = event.headers['x-ckoc-admin'] || event.headers['X-Ckoc-Admin']
    const isAdminOK = ADMIN_SECRET ? adminHeader === ADMIN_SECRET : true

    if (payload.action === 'deliver_queued') {
      if (!isAdminOK) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
      const result = await deliverQueued()
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...result }) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) }
  } catch (err: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err?.message || 'Server error' }) }
  }
}
