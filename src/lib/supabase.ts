import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// Simple auth helpers for the frontend
export const auth = {
  // IMPORTANT: When email confirmation is enabled in Supabase,
  // this returns { data: { user }, session: null } and DOES NOT sign the user in.
  // The UI must check data.session before treating the user as logged in.
  signUp: async (email: string, password: string, redirectPath = '/auth/callback') => {
    const emailRedirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}${redirectPath}`
        : undefined

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    })
    return { data, error }
  },

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  },
}
