import { supabase } from '@/lib/supabase';

// Content moderation utilities for CYBERKINGDOM
export const moderation = {
  // Check if content contains inappropriate material
  moderateContent: async (content: string): Promise<{ approved: boolean; reason?: string }> => {
    // Placeholder for content moderation logic
    // In production, this would integrate with AI moderation services
    
    const bannedWords = ['inappropriate', 'spam', 'offensive']; // Basic example
    const lowercaseContent = content.toLowerCase();
    
    for (const word of bannedWords) {
      if (lowercaseContent.includes(word)) {
        return {
          approved: false,
          reason: `Content contains inappropriate language: ${word}`,
        };
      }
    }

    return { approved: true };
  },

  // Report content for review
  reportContent: async (contentId: string, reporterId: string, reason: string) => {
    const { data, error } = await supabase
      .from('content_reports')
      .insert({
        content_id: contentId,
        reporter_id: reporterId,
        reason,
        status: 'pending',
        created_at: new Date().toISOString(),
      });

    return { data, error };
  },

  // Get moderation queue for admins
  getModerationQueue: async () => {
    const { data, error } = await supabase
      .from('content_reports')
      .select(`
        *,
        prayers (content, author_id),
        profiles!reporter_id (username)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    return { data, error };
  },

  // Approve or reject reported content
  moderateReport: async (reportId: string, action: 'approve' | 'reject', moderatorId: string) => {
    const { data, error } = await supabase
      .from('content_reports')
      .update({
        status: action === 'approve' ? 'approved' : 'rejected',
        moderator_id: moderatorId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', reportId);

    return { data, error };
  },
};