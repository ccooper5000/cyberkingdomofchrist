// netlify/functions/outreach-processor.ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { renderEmailHTML } from './email-template'

// ────────────────────────────────────────────────────────────────────────────
// ENV
// ────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const POSTMARK_SERVER_TOKEN = (process.env.POSTMARK_SERVER_TOKEN || '').trim() // Server API token
const EMAIL_FROM = (process.env.EMAIL_FROM || '').trim()                       // Verified sender or domain
const EMAIL_FROM_NAME = (process.env.EMAIL_FROM_NAME || 'Cyber Kingdom of Christ').trim()
const POSTMARK_STREAM = (process.env.POSTMARK_STREAM || 'outreach').trim()     // ← must match your Stream ID exactly
const POSTMARK_TEMPLATE_ALIAS = (process.env.POSTMARK_TEMPLATE_ALIAS || 'ckoc-outreach-v1').trim()

const SITE_URL = (process.env.SITE_URL || 'https://cyberkingdomofchrist.netlify.app').trim()
const ADMIN_SECRET = process.env.CKOC_ADMIN_SECRET

// ────────────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ────────────────────────────────────────────────────────────────────────────
// Types/Helpers
// ────────────────────────────────────────────────────────────────────────────
type Tier = 'free' | 'supporter' | 'patron' | 'admin'

function normalizeOffice(office: string | null): string {
  return (office || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}
function titleForRep(office: string | null): 'Sen.' | 'Rep.' | 'President' | 'Hon.' {
  const o = normalizeOffice(office)
  if (o.includes('president')) return 'President'
  if (o.includes('senate') || o.includes('senator')) return 'Sen.'
  if (o.includes('house') || o.includes('representative') || o.includes('congress')) return 'Rep.'
  return 'Hon.'
}
function lastNameFrom(name: string): string {
  const raw = (name || '').replace(/[.,]/g, ' ').trim()
  const parts = raw.split(/\s+/)
  const suffixes = new Set(['jr','jr.','sr','sr.','ii','iii','iv','phd','m.d.','md','esq','esq.'])
  while (parts.length && suffixes.has(parts[parts.length - 1].toLowerCase())) parts.pop()
  return parts.length ? parts[parts.length - 1] : (name || '').trim()
}
function greetingOnly(office: string | null, name: string): string {
  return `Dear ${titleForRep(office)} ${lastNameFrom(name)},`
}
function withGreeting(office: string | null, name: string, body: string): string {
  return `${greetingOnly(office, name)}\n\n${body || ''}`
}
/** Accept email as text[] or a Postgres array-literal string like "{a@b,c@d}". */
function normalizeEmails(val: unknown): string[] {
  if (Array.isArray(val)) {
    return (val as unknown[]).filter((x): x is string => typeof x === 'string')
  }
  if (typeof val === 'string') {
    return val.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean)
  }
  return []
}
function allowedChannelsForTier(_tier: Tier | null): Set<string> {
  // Today: email only
  return new Set(['email'])
}

const tierCache = new Map<string, Tier>()
async function getUserTier(userId: string): Promise<Tier> {
  const cached = tierCache.get(userId)
  if (cached) return cached
  const { data } = await supabase.from('profiles').select('tier').eq('id', userId).maybeSingle()
  const t = (data?.tier || 'free') as Tier
  tierCache.set(userId, t)
  return t
}

// Best-effort author metadata (email from auth, zip from profiles)
async function getAuthorMeta(userId: string): Promise<{ email: string | null; zip: string | null }> {
  let email: string | null = null
  let zip: string | null = null

  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (!error && data?.user?.email) email = data.user.email
  } catch {/* ignore */}

  try {
    const { data } = await supabase
      .from('profiles')
      .select('primary_zip, zip, postal_code')
      .eq('id', userId)
      .maybeSingle()
    zip = (data as any)?.primary_zip ?? (data as any)?.zip ?? (data as any)?.postal_code ?? null
  } catch {/* ignore */}

  return { email, zip }
}

// ────────────────────────────────────────────────────────────────────────────
// Data access
// ────────────────────────────────────────────────────────────────────────────
async function getQueued(limit = 50) {
  const { data, error } = await supabase
    .from('outreach_requests')
    .select(`
      id, user_id, prayer_id, target_rep_id, channels, status, subject, body,
      representatives:target_rep_id ( id, name, office, email ),
      prayers:prayer_id ( content )
    `)
    .eq('status', 'queued')
    .contains('channels', ['email'])
    .limit(limit)

  if (error) throw new Error(error.message)
  return data || []
}

async function markSent(id: string) {
  await supabase
    .from('outreach_requests')
    .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
    .eq('id', id)
}
async function markFailed(id: string, message: string) {
  await supabase
    .from('outreach_requests')
    .update({ status: 'failed', error: message })
    .eq('id', id)
}

// ────────────────────────────────────────────────────────────────────────────
// Postmark senders
// ────────────────────────────────────────────────────────────────────────────
type PostmarkSendResponse = {
  To?: string
  SubmittedAt?: string
  MessageID?: string
  ErrorCode: number
  Message: string
}

async function postmarkFetch(path: string, payload: Record<string, any>): Promise<PostmarkSendResponse> {
  const res = await fetch(`https://api.postmarkapp.com${path}`, {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': POSTMARK_SERVER_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  // Attempt to parse JSON either way (success or error)
  const json = (await res.json().catch(() => ({}))) as Partial<PostmarkSendResponse> & { Message?: string; ErrorCode?: number }

  // Postmark success = HTTP 200 and ErrorCode === 0
  const ok = res.ok && (json?.ErrorCode ?? 0) === 0
  if (!ok) {
    const msg = json?.Message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json as PostmarkSendResponse
}

// replace the function signature
async function sendWithPostmark(params: {
  to: string
  subject: string
  html?: string | null
  text?: string | null
  replyTo?: string | null            // ← add this
  template?: {
    alias: string
    model: Record<string, any>
  } | null
}) {
  const From = EMAIL_FROM_NAME ? `${EMAIL_FROM_NAME} <${EMAIL_FROM}>` : EMAIL_FROM

  if (params.template?.alias) {
    return postmarkFetch('/email/withTemplate', {
      From,
      To: params.to,
      TemplateAlias: params.template.alias,
      TemplateModel: params.template.model,
      MessageStream: POSTMARK_STREAM,
      ReplyTo: params.replyTo || undefined,   // ← add this
    })
  }

  return postmarkFetch('/email', {
    From,
    To: params.to,
    Subject: params.subject,
    HtmlBody: params.html || undefined,
    TextBody: params.text || undefined,
    MessageStream: POSTMARK_STREAM,
    ReplyTo: params.replyTo || undefined,     // ← add this
  })
}


// ────────────────────────────────────────────────────────────────────────────
type DispatchDetail = {
  request_id: string
  to: string
  message_id?: string
  used_stream: string
  used_template_alias?: string | null
  status: 'sent' | 'failed'
  error?: string
}

// Deliver logic
// ────────────────────────────────────────────────────────────────────────────
async function deliverQueued(): Promise<{
  processed: number
  sent: number
  failed: number
  used_stream: string
  used_template_alias: string | null
  details: DispatchDetail[]
}> {
  if (!POSTMARK_SERVER_TOKEN) throw new Error('POSTMARK_SERVER_TOKEN missing')
  if (!EMAIL_FROM) throw new Error('EMAIL_FROM missing')

  const batch = await getQueued(100)
  let processed = 0, sent = 0, failed = 0
  const details: DispatchDetail[] = []

  for (const row of batch as any[]) {
    processed += 1

    const rep = row.representatives as { id: string; name: string; office: string | null; email: unknown } | null
    if (!rep) {
      await markFailed(row.id, 'Representative not found')
      failed++
      details.push({ request_id: row.id, to: '(none)', used_stream: POSTMARK_STREAM, used_template_alias: POSTMARK_TEMPLATE_ALIAS || null, status: 'failed', error: 'Representative not found' })
      continue
    }

    // 1) Tier enforcement
    const tier = await getUserTier(row.user_id)
    const allowed = allowedChannelsForTier(tier)
    const requested: string[] = row.channels || []
    const disallowed = requested.filter((ch) => !allowed.has(ch))
    if (disallowed.length) {
      const msg = `Channel(s) not allowed for tier '${tier}': ${disallowed.join(', ')}`
      await markFailed(row.id, msg)
      failed++
      details.push({ request_id: row.id, to: '(none)', used_stream: POSTMARK_STREAM, used_template_alias: POSTMARK_TEMPLATE_ALIAS || null, status: 'failed', error: msg })
      continue
    }

    // 2) Resolve recipient email
    const emails = normalizeEmails(rep.email)
    const toEmail = emails[0] ?? null
    if (!toEmail) {
      await markFailed(row.id, 'No email on file for representative')
      failed++
      details.push({ request_id: row.id, to: '(none)', used_stream: POSTMARK_STREAM, used_template_alias: POSTMARK_TEMPLATE_ALIAS || null, status: 'failed', error: 'No email on file for representative' })
      continue
    }

    // 3) Compose (greeting + body/prayer)
    const subject = row.subject || 'Message from a Cyber Kingdom of Christ user'
    const greeting = greetingOnly(rep.office, (rep as any).name)
    const prayerText: string = row.body || row?.prayers?.content || ''

    // 4) Optional author metadata (for template fields)
    const { email: authorEmail, zip: authorZip } = await getAuthorMeta(row.user_id)

    // 5) Send (template if available, else HTML/text)
    try {
      let resp: PostmarkSendResponse | undefined

      if (POSTMARK_TEMPLATE_ALIAS) {
        resp = await sendWithPostmark({
          to: toEmail,
          subject, // ignored by Postmark template (subject comes from template)
          replyTo: authorEmail || null,
          template: {
            alias: POSTMARK_TEMPLATE_ALIAS,
            model: {
              subject, // in case your template uses it
              recipient_name: rep.name,
              recipient_office: rep.office || '',
              greeting,
              prayer_text: prayerText,
              author_email: authorEmail || '',
              author_zip: authorZip || '',
              site_url: SITE_URL,
            },
          },
        })
      } else {
        const text = withGreeting(rep.office, (rep as any).name, prayerText)
        const html = renderEmailHTML({ subject, greeting, body: prayerText })
        resp = await sendWithPostmark({ to: toEmail, subject, html, text, replyTo: authorEmail || null, })
      }

      await markSent(row.id)
      sent += 1
      details.push({
        request_id: row.id,
        to: toEmail,
        message_id: resp?.MessageID,
        used_stream: POSTMARK_STREAM,
        used_template_alias: POSTMARK_TEMPLATE_ALIAS || null,
        status: 'sent',
      })
    } catch (e: any) {
      const err = String(e?.message || 'Send failed')
      await markFailed(row.id, err)
      failed += 1
      details.push({
        request_id: row.id,
        to: toEmail,
        used_stream: POSTMARK_STREAM,
        used_template_alias: POSTMARK_TEMPLATE_ALIAS || null,
        status: 'failed',
        error: err,
      })
    }
  }

  return {
    processed,
    sent,
    failed,
    used_stream: POSTMARK_STREAM,
    used_template_alias: POSTMARK_TEMPLATE_ALIAS || null,
    details,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────────
export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-ckoc-admin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const adminHeader = event.headers['x-ckoc-admin'] || event.headers['X-Ckoc-Admin']
  const isAdminOK = ADMIN_SECRET ? adminHeader === ADMIN_SECRET : true
  if (!isAdminOK) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  try {
    const payload = JSON.parse(event.body || '{}')

    if (payload.action === 'deliver_queued') {
      const result = await deliverQueued()
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...result }) }
    }

    if (payload.action === 'mark_sent') {
      const ids: string[] = Array.isArray(payload.ids) ? payload.ids : []
      if (!ids.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No ids provided' }) }
      }
      const { error } = await supabase
        .from('outreach_requests')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .in('id', ids)
      if (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Update failed: ${error.message}` }) }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, updated: ids.length }) }
    }

    if (payload.action === 'group_invitation') {
      // placeholder – your group invitation logic can reuse sendWithPostmark if needed
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) }
  } catch (e: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e?.message || 'Server error' }) }
  }
}
