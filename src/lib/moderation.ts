import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'

type ModerationFlagRow = Database['public']['Tables']['moderation_flags']['Row']
type ModerationFlagInsert = Database['public']['Tables']['moderation_flags']['Insert']

// NOTE: Our schema uses `entity_type` and `entity_id`.
// This file defaults `entity_type` to 'prayer' to stay backward-compatible
// with the existing function signatures. If/when you moderate other entities
// (e.g., comments), consider adding an optional entityType param.

export const moderation = {
  // Simple content filter (placeholder for real AI moderation)
  moderateContent: async (
    content: string
  ): Promise<{ approved: boolean; reason?: string }> => {
    const bannedWords = ['inappropriate', 'spam', 'offensive']
    const text = (content || '').toLowerCase()

    for (const word of bannedWords) {
      if (text.includes(word)) {
        return { approved: false, reason: `Content contains: ${word}` }
      }
    }
    return { approved: true }
  },

  // Report content for review (defaults to entity_type = 'prayer')
  reportContent: async (
    contentId: string,
    reporterId: string,
    reason: string
  ) => {
    const now = new Date().toISOString()

    const insert: ModerationFlagInsert = {
      entity_type: 'prayer',
      entity_id: contentId,
      flagged_by: reporterId ?? null,
      reason,
      status: 'open',
      created_at: now,
    }

    const { data, error } = await supabase
      .from('moderation_flags')
      .insert(insert)
      .select()
      .single()

    // Best-effort audit trail
    if (!error) {
      await supabase.from('audit_logs').insert({
        action: 'moderation_flag_created',
        entity_type: 'prayer',
        entity_id: contentId,
        actor_user_id: reporterId ?? null,
        metadata: { reason, flagId: (data as ModerationFlagRow)?.id },
        created_at: now,
      })
    }

    return { data, error }
  },

  // Get open items in the moderation queue
  // (No FK on moderation_flags, so we return just the flags;
  //  the UI can fetch related entity details separately if needed.)
  getModerationQueue: async () => {
    const { data, error } = await supabase
      .from('moderation_flags')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false })

    return { data, error }
  },

  // Resolve a report (approve = keep content, reject = take action),
  // we close the flag either way and record the decision in audit_logs.
  moderateReport: async (
    reportId: string,
    action: 'approve' | 'reject',
    moderatorId: string
  ) => {
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('moderation_flags')
      .update({ status: 'closed', resolved_at: now })
      .eq('id', reportId)
      .select()
      .single()

    if (!error) {
      await supabase.from('audit_logs').insert({
        action: 'moderation_flag_resolved',
        entity_type: (data as ModerationFlagRow)?.entity_type,
        entity_id: (data as ModerationFlagRow)?.entity_id,
        actor_user_id: moderatorId ?? null,
        metadata: { decision: action, flagId: (data as ModerationFlagRow)?.id },
        created_at: now,
      })
    }

    return { data, error }
  },
}
