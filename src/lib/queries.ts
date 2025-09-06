// src/lib/queries.ts
// Ready-to-use Supabase query helpers for CyberKingdomOfChrist.org

import { supabase } from '@/lib/supabaseClient';
import type {
  Profile,
  Subscription,
  SubscriptionStatus,
  SubscriptionTier,
  Prayer,
  PrayerInsert,
  PrayerComment,
  PrayerCommentInsert,
  PrayerLike,
  PrayerShare,
  SharePlatform,
  UserAddress,
  Representative,
  UserRepresentative,
  OutreachRequestInsert,
  StrictPrayer,
  Visibility,
} from '@/types/dbTypes';

// ----------------------
// AUTH / CURRENT USER
// ----------------------
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user ?? null;
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle<Profile>();
  if (error) throw error;
  return data ?? null;
}

// ----------------------
// SUBSCRIPTIONS / TIERS
// ----------------------
export async function getActiveSubscription(
  userId: string
): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'] as SubscriptionStatus[])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<Subscription>();
  if (error) throw error;
  return data ?? null;
}

export async function getUserTier(
  userId: string
): Promise<SubscriptionTier | 'free'> {
  const sub = await getActiveSubscription(userId);
  return (sub?.tier as SubscriptionTier) ?? 'free';
}

// ----------------------
// PRAYERS (FEED + CRUD)
// ----------------------
export type FeedOptions = {
  limit?: number;
  before?: string; // ISO timestamp for pagination
  category?: Prayer['category'];
  featuredFirst?: boolean;
};

export async function fetchFeed({
  limit = 50,
  before,
  category,
  featuredFirst = true,
}: FeedOptions = {}): Promise<StrictPrayer[]> {
  let query = supabase
    .from('prayers')
    .select('id, author_id, category, content, created_at, updated_at, is_featured, visibility')
    .eq('visibility', 'public' as Visibility);

  if (category) query = query.eq('category', category);
  if (before) query = query.lt('created_at', before);

  // Basic ranking: featured first, then recent
  if (featuredFirst) {
    query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query.limit(limit);
  if (error) throw error;

  // Narrow visibility at type-level
  return (data ?? []).map((p) => ({ ...p, visibility: (p.visibility as Visibility) })) as StrictPrayer[];
}

export async function countTodaysPosts(userId: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('prayers')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', userId)
    .gte('created_at', start.toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function insertPrayer(input: Omit<PrayerInsert, 'author_id' | 'visibility'> & {
  author_id: string;
  visibility?: Visibility; // default public
}) {
  // Client-side cap for free tier can call getUserTier + countTodaysPosts before insert
  const { data, error } = await supabase
    .from('prayers')
    .insert({
      author_id: input.author_id,
      category: input.category,
      content: input.content,
      visibility: input.visibility ?? ('public' as Visibility),
      group_id: input.group_id ?? null,
      circle_id: input.circle_id ?? null,
      is_featured: false,
    })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// ----------------------
// LIKES / COMMENTS / SHARES
// ----------------------
export async function likePrayer(prayerId: string, userId: string) {
  const { error } = await supabase
    .from('prayer_likes')
    .insert({ prayer_id: prayerId, user_id: userId } as PrayerLike);
  if (error) throw error;
}

export async function unlikePrayer(prayerId: string, userId: string) {
  const { error } = await supabase
    .from('prayer_likes')
    .delete()
    .eq('prayer_id', prayerId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function addComment(prayerId: string, userId: string, content: string) {
  const payload: PrayerCommentInsert = { prayer_id: prayerId, author_id: userId, content };
  const { data, error } = await supabase
    .from('prayer_comments')
    .insert(payload)
    .select('id, created_at')
    .maybeSingle<Pick<PrayerComment, 'id' | 'created_at'>>();
  if (error) throw error;
  return data ?? null;
}

export async function recordShare(prayerId: string, userId: string, platform: SharePlatform, shareRef?: string) {
  const { error } = await supabase
    .from('prayer_shares')
    .insert({ prayer_id: prayerId, user_id: userId, platform, share_ref: shareRef } as PrayerShare);
  if (error) throw error;
}

// ----------------------
// ADDRESS → REPRESENTATIVES
// ----------------------
export async function upsertPrimaryAddress(userId: string, address: Partial<UserAddress>) {
  // Ensure single primary per user (RLS allows self only)
  // Strategy: set is_primary true on upsert; unique index enforces single primary
  const { data, error } = await supabase
    .from('user_addresses')
    .upsert(
      {
        user_id: userId,
        line1: address.line1 ?? null,
        line2: address.line2 ?? null,
        city: address.city ?? null,
        state: address.state ?? null,
        postal_code: address.postal_code ?? null,
        country: address.country ?? 'US',
        is_primary: true,
        lat: address.lat ?? null,
        lng: address.lng ?? null,
        county: address.county ?? null,
        cd: address.cd ?? null,
        sd: address.sd ?? null,
        hd: address.hd ?? null,
        muni: address.muni ?? null,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .maybeSingle<UserAddress>();
  if (error) throw error;
  return data!;
}

export async function getUserRepresentatives(userId: string) {
  const { data, error } = await supabase
    .from('user_representatives')
    .select('rep_id, level, representatives(*)')
    .eq('user_id', userId);
  if (error) throw error;

  // Flatten to an easier shape
  return (data ?? []).map((r) => ({
    level: r.level,
    rep: r.representatives as unknown as Representative,
  })) as { level: UserRepresentative['level']; rep: Representative }[];
}

// ----------------------
// OUTREACH (Kingdom Builder)
// ----------------------
export async function enqueueOutreach(
  userId: string,
  prayerId: string,
  targets: { repId: string; channels: ('email' | 'x' | 'facebook')[] }[]
) {
  const rows: OutreachRequestInsert[] = targets.map((t) => ({
    user_id: userId,
    prayer_id: prayerId,
    target_rep_id: t.repId,
    channels: t.channels,
    status: 'queued',
  }));

  const { error } = await supabase.from('outreach_requests').insert(rows);
  if (error) throw error;
}

export async function getOutreachStatus(userId: string, prayerId: string) {
  const { data, error } = await supabase
    .from('outreach_requests')
    .select('id, target_rep_id, channels, status, error, sent_at')
    .eq('user_id', userId)
    .eq('prayer_id', prayerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
