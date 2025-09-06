// src/types/dbTypes.ts
import type { Database } from './database';

// ---------- Row type aliases ----------
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type UserAddress = Database['public']['Tables']['user_addresses']['Row'];
export type Subscription = Database['public']['Tables']['subscriptions']['Row'];
export type Prayer = Database['public']['Tables']['prayers']['Row'];
export type PrayerLike = Database['public']['Tables']['prayer_likes']['Row'];
export type PrayerComment = Database['public']['Tables']['prayer_comments']['Row'];
export type PrayerShare = Database['public']['Tables']['prayer_shares']['Row'];
export type Group = Database['public']['Tables']['groups']['Row'];
export type GroupMember = Database['public']['Tables']['group_members']['Row'];
export type PrayerCircle = Database['public']['Tables']['prayer_circles']['Row'];
export type CircleMember = Database['public']['Tables']['circle_members']['Row'];
export type Representative = Database['public']['Tables']['representatives']['Row'];
export type UserRepresentative = Database['public']['Tables']['user_representatives']['Row'];
export type OutreachRequest = Database['public']['Tables']['outreach_requests']['Row'];
export type ModerationFlag = Database['public']['Tables']['moderation_flags']['Row'];
export type AuditLog = Database['public']['Tables']['audit_logs']['Row'];
export type PrivacyConsent = Database['public']['Tables']['privacy_consents']['Row'];
export type StripeEvent = Database['public']['Tables']['stripe_events']['Row'];

// ---------- Insert type aliases ----------
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
export type UserAddressInsert = Database['public']['Tables']['user_addresses']['Insert'];
export type SubscriptionInsert = Database['public']['Tables']['subscriptions']['Insert'];
export type PrayerInsert = Database['public']['Tables']['prayers']['Insert'];
export type PrayerLikeInsert = Database['public']['Tables']['prayer_likes']['Insert'];
export type PrayerCommentInsert = Database['public']['Tables']['prayer_comments']['Insert'];
export type PrayerShareInsert = Database['public']['Tables']['prayer_shares']['Insert'];
export type GroupInsert = Database['public']['Tables']['groups']['Insert'];
export type GroupMemberInsert = Database['public']['Tables']['group_members']['Insert'];
export type PrayerCircleInsert = Database['public']['Tables']['prayer_circles']['Insert'];
export type CircleMemberInsert = Database['public']['Tables']['circle_members']['Insert'];
export type RepresentativeInsert = Database['public']['Tables']['representatives']['Insert'];
export type UserRepresentativeInsert = Database['public']['Tables']['user_representatives']['Insert'];
export type OutreachRequestInsert = Database['public']['Tables']['outreach_requests']['Insert'];
export type ModerationFlagInsert = Database['public']['Tables']['moderation_flags']['Insert'];
export type AuditLogInsert = Database['public']['Tables']['audit_logs']['Insert'];
export type PrivacyConsentInsert = Database['public']['Tables']['privacy_consents']['Insert'];
export type StripeEventInsert = Database['public']['Tables']['stripe_events']['Insert'];

// ---------- Update type aliases ----------
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];
export type UserAddressUpdate = Database['public']['Tables']['user_addresses']['Update'];
export type SubscriptionUpdate = Database['public']['Tables']['subscriptions']['Update'];
export type PrayerUpdate = Database['public']['Tables']['prayers']['Update'];
export type PrayerLikeUpdate = Database['public']['Tables']['prayer_likes']['Update'];
export type PrayerCommentUpdate = Database['public']['Tables']['prayer_comments']['Update'];
export type PrayerShareUpdate = Database['public']['Tables']['prayer_shares']['Update'];
export type GroupUpdate = Database['public']['Tables']['groups']['Update'];
export type GroupMemberUpdate = Database['public']['Tables']['group_members']['Update'];
export type PrayerCircleUpdate = Database['public']['Tables']['prayer_circles']['Update'];
export type CircleMemberUpdate = Database['public']['Tables']['circle_members']['Update'];
export type RepresentativeUpdate = Database['public']['Tables']['representatives']['Update'];
export type UserRepresentativeUpdate = Database['public']['Tables']['user_representatives']['Update'];
export type OutreachRequestUpdate = Database['public']['Tables']['outreach_requests']['Update'];
export type ModerationFlagUpdate = Database['public']['Tables']['moderation_flags']['Update'];
export type AuditLogUpdate = Database['public']['Tables']['audit_logs']['Update'];
export type PrivacyConsentUpdate = Database['public']['Tables']['privacy_consents']['Update'];
export type StripeEventUpdate = Database['public']['Tables']['stripe_events']['Update'];

// ---------- Helpful unions mirroring DB check constraints ----------
export type PrayerCategory = Database['public']['Enums']['prayer_category'];
export type SubscriptionTier = Database['public']['Enums']['subscription_tier'];
export type Visibility = 'public' | 'group' | 'circle';
export type RepLevel = 'local' | 'state' | 'federal';
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete';
export type SharePlatform =
  | 'facebook'
  | 'x'
  | 'instagram'
  | 'tiktok'
  | 'whatsapp'
  | 'telegram'
  | 'other';

// ---------- Narrowed "strict" row types ----------
export type StrictPrayer = Omit<Prayer, 'visibility'> & { visibility: Visibility };
export type StrictUserRepresentative = Omit<UserRepresentative, 'level'> & {
  level: RepLevel;
};
export type StrictSubscription = Omit<Subscription, 'status'> & {
  status: SubscriptionStatus;
};
export type StrictPrayerShare = Omit<PrayerShare, 'platform'> & {
  platform: SharePlatform;
};
