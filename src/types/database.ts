export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      banned_terms: {
        Row: {
          pattern: string
          term: string
        }
        Insert: {
          pattern: string
          term: string
        }
        Update: {
          pattern?: string
          term?: string
        }
        Relationships: []
      }
      circle_members: {
        Row: {
          circle_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          circle_id: string
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          circle_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_members_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "prayer_circles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "circle_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "prayer_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string
          group_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_flags: {
        Row: {
          ai_score: number | null
          created_at: string
          entity_id: string
          entity_type: string
          flagged_by: string | null
          id: string
          reason: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          ai_score?: number | null
          created_at?: string
          entity_id: string
          entity_type: string
          flagged_by?: string | null
          id?: string
          reason: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          ai_score?: number | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          flagged_by?: string | null
          id?: string
          reason?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: []
      }
      outreach_requests: {
        Row: {
          body: string | null
          channels: string[]
          created_at: string
          error: string | null
          id: string
          prayer_id: string
          send_date: string | null
          sent_at: string | null
          status: string
          subject: string | null
          target_rep_id: string
          user_id: string
        }
        Insert: {
          body?: string | null
          channels: string[]
          created_at?: string
          error?: string | null
          id?: string
          prayer_id: string
          send_date?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          target_rep_id: string
          user_id: string
        }
        Update: {
          body?: string | null
          channels?: string[]
          created_at?: string
          error?: string | null
          id?: string
          prayer_id?: string
          send_date?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          target_rep_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_requests_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "prayer_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_requests_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "prayers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_requests_target_rep_id_fkey"
            columns: ["target_rep_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_circles: {
        Row: {
          created_at: string
          id: string
          is_private: boolean
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_private?: boolean
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_private?: boolean
          name?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_circles_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_comments: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          prayer_id: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          prayer_id: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          prayer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_comments_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "prayer_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_comments_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "prayers"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_likes: {
        Row: {
          created_at: string
          prayer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          prayer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          prayer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_likes_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "prayer_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_likes_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "prayers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_shares: {
        Row: {
          created_at: string
          id: string
          platform: string
          prayer_id: string
          share_ref: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform: string
          prayer_id: string
          share_ref?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          prayer_id?: string
          share_ref?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_shares_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "prayer_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_shares_prayer_id_fkey"
            columns: ["prayer_id"]
            isOneToOne: false
            referencedRelation: "prayers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prayers: {
        Row: {
          author_id: string
          category: Database["public"]["Enums"]["prayer_category"]
          circle_id: string | null
          content: string
          created_at: string
          group_id: string | null
          id: string
          is_featured: boolean
          updated_at: string
          visibility: string
        }
        Insert: {
          author_id: string
          category: Database["public"]["Enums"]["prayer_category"]
          circle_id?: string | null
          content: string
          created_at?: string
          group_id?: string | null
          id?: string
          is_featured?: boolean
          updated_at?: string
          visibility?: string
        }
        Update: {
          author_id?: string
          category?: Database["public"]["Enums"]["prayer_category"]
          circle_id?: string | null
          content?: string
          created_at?: string
          group_id?: string | null
          id?: string
          is_featured?: boolean
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayers_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_consents: {
        Row: {
          consented_at: string
          email_opt_in: boolean
          id: string
          policy_version: string
          user_id: string
        }
        Insert: {
          consented_at?: string
          email_opt_in?: boolean
          id?: string
          policy_version: string
          user_id: string
        }
        Update: {
          consented_at?: string
          email_opt_in?: boolean
          id?: string
          policy_version?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          first_name: string | null
          id: string
          is_public: boolean
          last_name: string | null
          phone: string | null
          tier: string
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          first_name?: string | null
          id: string
          is_public?: boolean
          last_name?: string | null
          phone?: string | null
          tier?: string
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          first_name?: string | null
          id?: string
          is_public?: boolean
          last_name?: string | null
          phone?: string | null
          tier?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      representatives: {
        Row: {
          chamber: string | null
          created_at: string | null
          district: string | null
          division_id: string
          email: string | null
          facebook: string | null
          id: string
          instagram: string | null
          level: string | null
          name: string
          office_name: string
          party: string | null
          phone: string | null
          source: string
          state: string | null
          twitter: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          chamber?: string | null
          created_at?: string | null
          district?: string | null
          division_id: string
          email?: string | null
          facebook?: string | null
          id?: string
          instagram?: string | null
          level?: string | null
          name: string
          office_name: string
          party?: string | null
          phone?: string | null
          source?: string
          state?: string | null
          twitter?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          chamber?: string | null
          created_at?: string | null
          district?: string | null
          division_id?: string
          email?: string | null
          facebook?: string | null
          id?: string
          instagram?: string | null
          level?: string | null
          name?: string
          office_name?: string
          party?: string | null
          phone?: string | null
          source?: string
          state?: string | null
          twitter?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          data: Json
          id: string
          received_at: string
          type: string
        }
        Insert: {
          data: Json
          id: string
          received_at?: string
          type: string
        }
        Update: {
          data?: Json
          id?: string
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          id: string
          renewal_at: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: Database["public"]["Enums"]["subscription_tier"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          renewal_at?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier: Database["public"]["Enums"]["subscription_tier"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          renewal_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: Database["public"]["Enums"]["subscription_tier"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_addresses: {
        Row: {
          cd: string | null
          city: string | null
          country: string | null
          county: string | null
          created_at: string
          hd: string | null
          id: string
          is_primary: boolean
          lat: number | null
          line1: string | null
          line2: string | null
          lng: number | null
          muni: string | null
          postal_code: string | null
          sd: string | null
          state: string | null
          user_id: string
        }
        Insert: {
          cd?: string | null
          city?: string | null
          country?: string | null
          county?: string | null
          created_at?: string
          hd?: string | null
          id?: string
          is_primary?: boolean
          lat?: number | null
          line1?: string | null
          line2?: string | null
          lng?: number | null
          muni?: string | null
          postal_code?: string | null
          sd?: string | null
          state?: string | null
          user_id: string
        }
        Update: {
          cd?: string | null
          city?: string | null
          country?: string | null
          county?: string | null
          created_at?: string
          hd?: string | null
          id?: string
          is_primary?: boolean
          lat?: number | null
          line1?: string | null
          line2?: string | null
          lng?: number | null
          muni?: string | null
          postal_code?: string | null
          sd?: string | null
          state?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_daily_limits: {
        Row: {
          daily_limit: number
          user_id: string
        }
        Insert: {
          daily_limit: number
          user_id: string
        }
        Update: {
          daily_limit?: number
          user_id?: string
        }
        Relationships: []
      }
      user_representatives: {
        Row: {
          created_at: string
          is_favorite: boolean
          level: string
          rep_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_favorite?: boolean
          level: string
          rep_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_favorite?: boolean
          level?: string
          rep_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_representatives_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "representatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_representatives_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      prayer_feed: {
        Row: {
          author_id: string | null
          category: Database["public"]["Enums"]["prayer_category"] | null
          circle_id: string | null
          content: string | null
          created_at: string | null
          group_id: string | null
          id: string | null
          is_featured: boolean | null
          like_count: number | null
          updated_at: string | null
          visibility: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prayers_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      contains_banned: {
        Args: { t: string }
        Returns: boolean
      }
      count_comment_likes: {
        Args: { p_comment_id: string }
        Returns: number
      }
      count_prayer_likes: {
        Args: { p_prayer_id: string }
        Returns: number
      }
    }
    Enums: {
      outreach_status: "queued" | "sent" | "failed"
      prayer_category:
        | "trump_politics"
        | "health"
        | "family"
        | "business"
        | "national"
        | "custom"
      subscription_tier: "free" | "faith_warrior" | "kingdom_builder"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      outreach_status: ["queued", "sent", "failed"],
      prayer_category: [
        "trump_politics",
        "health",
        "family",
        "business",
        "national",
        "custom",
      ],
      subscription_tier: ["free", "faith_warrior", "kingdom_builder"],
    },
  },
} as const
