// src/pages/Login.tsx
import React, { useEffect, useState } from 'react'
import { supabase, auth } from '@/lib/supabase'
import { ensurePrimaryZip } from '@/lib/zip'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'

type Mode = 'signin' | 'signup'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')

  // shared fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // signup-only
  const [zip, setZip] = useState('')

  // ui state
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // On mount: if a ZIP was saved during email-confirm flow, try to apply it once the user is actually signed in.
  useEffect(() => {
    let active = true
    ;(async () => {
      const storedZip = localStorage.getItem('ckoc_pending_zip')
      if (!storedZip) return

      const { data } = await supabase.auth.getUser()
      if (!active || !data.user) return

      const res = await ensurePrimaryZip(storedZip)
      if ((res as any)?.ok || (res as any)?.locked) {
        localStorage.removeItem('ckoc_pending_zip')
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const doSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMsg(null)
    if (busy) return
    setBusy(true)

    try {
      const pwd = password // snapshot
      setPassword('')      // clear ASAP

      const { error } = await auth.signIn(email, pwd)
      if (error) {
        setError(error.message || 'Sign in failed.')
        return
      }

      // If a ZIP was persisted pre-confirmation, apply it after first sign-in.
      const pendingZip = localStorage.getItem('ckoc_pending_zip')
      if (pendingZip) {
        const res = await ensurePrimaryZip(pendingZip)
        if ((res as any)?.ok || (res as any)?.locked) {
          localStorage.removeItem('ckoc_pending_zip')
        }
      }

      navigate('/feed')
    } finally {
      setBusy(false)
    }
  }

  const doSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMsg(null)
    if (busy) return

    // Basic ZIP validation (US 5 or 9 digits)
    const zipOk = /^[0-9]{5}(?:-[0-9]{4})?$/.test(zip)
    if (!zipOk) {
      setError('Enter a valid US ZIP (12345 or 12345-6789).')
      return
    }

    setBusy(true)
    try {
      const pwd = password // snapshot
      setPassword('')      // clear ASAP

      // auth.signUp() sets emailRedirectTo to /auth/callback and does NOT sign in when confirmations are ON
      const { data, error } = await auth.signUp(email, pwd)
      if (error) {
        setError(error.message || 'Sign up failed.')
        return
      }

      const hasSession = !!data?.session

      if (hasSession) {
        // (Confirmations OFF) — set ZIP immediately
        const res = await ensurePrimaryZip(zip)
        if (!(res as any)?.ok && !(res as any)?.locked) {
          setError((res as any)?.message || 'Could not store ZIP.')
          return
        }
        navigate('/feed')
        return
      }

      // (Confirmations ON) — stash ZIP and prompt the user to confirm by email
      localStorage.setItem('ckoc_pending_zip', zip)
      setMsg('Please check your email to confirm your account. After confirming, sign in to continue.')
      setMode('signin')
    } finally {
      setBusy(false)
    }
  }

  const isSignup = mode === 'signup'
  const passwordAC = isSignup ? 'new-password' : 'current-password'

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={mode === 'signin' ? doSignIn : doSignUp}
        className="w-full max-w-sm space-y-4 border rounded-2xl p-6 bg-white"
        autoComplete="on"
      >
        <h1 className="text-2xl font-bold">
          {mode === 'signin' ? 'Sign In' : 'Create Account'}
        </h1>

        {msg && <p className="text-sm text-green-700">{msg}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-md px-3 py-2"
            placeholder="you@example.com"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded-md px-3 py-2"
            placeholder="••••••••"
            autoComplete={passwordAC}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            minLength={6}
          />
        </div>

        {isSignup && (
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="signup-zip">
              ZIP (required, US only)
            </label>
            <input
              id="signup-zip"
              name="postal-code"
              inputMode="numeric"
              required
              value={zip}
              onChange={(e) => setZip(e.target.value.trim())}
              className="w-full border rounded-md px-3 py-2"
              placeholder="12345 or 12345-6789"
              maxLength={10}
              autoComplete="postal-code"
            />
            <p className="text-xs text-gray-500">
              Your ZIP is used to match your representatives. It’s locked after creation.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button type="submit" disabled={busy}>
            {busy ? 'Please wait…' : (mode === 'signin' ? 'Sign In' : 'Create Account')}
          </Button>

          <button
            type="button"
            className="text-sm text-blue-700 underline"
            onClick={() => {
              setError(null)
              setMsg(null)
              setMode(mode === 'signin' ? 'signup' : 'signin')
            }}
          >
            {mode === 'signin' ? 'Create account' : 'Have an account? Sign in'}
          </button>
        </div>
      </form>
    </div>
  )
}
