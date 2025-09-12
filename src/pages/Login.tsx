// src/pages/Login.tsx
import React, { useEffect, useState } from 'react'
import { supabase, auth } from '@/lib/supabase'
import { ensurePrimaryZip } from '@/lib/zip'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'
import {
  saveMyProfile,
  setPendingProfileLocal,
  applyPendingProfileFromLocalStorage,
  isUsernameAvailable,
} from '@/lib/profile'

type Mode = 'signin' | 'signup'

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')

  // shared fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // signup-only (new profile fields)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [zip, setZip] = useState('')

  // username availability (signup)
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'error'
  >('idle')

  // ui state
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // On mount: if a ZIP was saved during email-confirm flow, apply it once the user is actually signed in.
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

  // On mount: if a profile was saved during email-confirm flow, apply it once the user is signed in.
  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!active || !data.user) return
      await applyPendingProfileFromLocalStorage()
    })()
    return () => {
      active = false
    }
  }, [])

  // Debounced username availability check (signup only)
  useEffect(() => {
    if (mode !== 'signup') return
    const raw = username.trim().toLowerCase()
    if (!raw) {
      setUsernameStatus('idle')
      return
    }
    let cancelled = false
    setUsernameStatus('checking')
    const handle = setTimeout(async () => {
      try {
        const available = await isUsernameAvailable(raw)
        if (cancelled) return
        setUsernameStatus(available ? 'available' : 'taken')
      } catch {
        if (cancelled) return
        setUsernameStatus('error')
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [username, mode])

  const navigateWithWelcome = async () => {
    // Fetch the freshly signed-in user so we can personalize the welcome
    const { data } = await supabase.auth.getUser()
    const u = data?.user
    const uid = u?.id
    const who =
      (u?.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) ||
      u?.email ||
      'Welcome!'
    navigate('/feed', {
      replace: true,
      state: {
        flash: {
          kind: 'welcome',
          text: `Welcome, ${who}`,
          // unique per login to show exactly once per session
          onceKey: uid ? `welcome:${uid}:${Date.now()}` : `welcome:${Date.now()}`
        }
      }
    })
  }

  const doSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setMsg(null)
    if (busy) return
    setBusy(true)

    try {
      const pwd = password
      setPassword('') // clear ASAP

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

      // Apply any pending profile from pre-confirmation
      await applyPendingProfileFromLocalStorage()

      await navigateWithWelcome()
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

    // Basic username sanity before network
    const uname = (username || '').trim().toLowerCase()
    if (!/^[a-z0-9_]{3,24}$/.test(uname)) {
      setError('Username must be 3–24 characters: lowercase letters, numbers, or underscores.')
      return
    }
    if (usernameStatus === 'taken' || usernameStatus === 'checking') {
      setError('Please choose an available username.')
      return
    }

    setBusy(true)
    try {
      const pwd = password
      setPassword('') // clear ASAP

      // auth.signUp() sets emailRedirectTo and does NOT sign in when confirmations are ON
      const { data, error } = await auth.signUp(email, pwd)
      if (error) {
        setError(error.message || 'Sign up failed.')
        return
      }

      const hasSession = !!data?.session
      const profilePayload = {
        first_name: firstName || null,
        last_name: lastName || null,
        username: uname || null,
        bio: bio || null,
      }

      if (hasSession) {
        // Confirmations OFF — set ZIP immediately, then save profile
        const res = await ensurePrimaryZip(zip)
        if (!(res as any)?.ok && !(res as any)?.locked) {
          setError((res as any)?.message || 'Could not store ZIP.')
          return
        }

        const saveRes = await saveMyProfile(profilePayload)
        if (!saveRes.ok) {
          // If something is off (e.g., conflict), stash to apply later
          setPendingProfileLocal(profilePayload)
        }

        await navigateWithWelcome()
        return
      }

      // Confirmations ON — stash ZIP + profile for after email verification
      localStorage.setItem('ckoc_pending_zip', zip)
      setPendingProfileLocal(profilePayload)
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
          <>
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

            {/* Signup: Profile fields */}
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium">First name</label>
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    maxLength={50}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium">Last name</label>
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    maxLength={50}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="username" className="block text-sm font-medium">Username</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  inputMode="text"
                  pattern="^[a-z0-9_]{3,24}$"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => setUsername((u) => u.trim().toLowerCase())}
                  minLength={3}
                  maxLength={24}
                  title="3–24 chars: lowercase letters, numbers, or underscores"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  className="w-full border rounded-md px-3 py-2"
                  placeholder="@username"
                />
                <p className="mt-1 text-xs text-gray-500">
                  3–24 chars: lowercase letters, numbers, or underscores.
                </p>
                {usernameStatus === 'checking' && (
                  <p className="text-xs text-gray-500" aria-live="polite">Checking availability…</p>
                )}
                {usernameStatus === 'available' && (
                  <p className="text-xs text-green-600" aria-live="polite">Username is available.</p>
                )}
                {usernameStatus === 'taken' && (
                  <p className="text-xs text-red-600" aria-live="polite">That username is already taken.</p>
                )}
                {usernameStatus === 'error' && (
                  <p className="text-xs text-red-600" aria-live="polite">Couldn’t check availability. Try again.</p>
                )}
              </div>

              <div>
                <label htmlFor="bio" className="block text-sm font-medium">Short bio (optional)</label>
                <textarea
                  id="bio"
                  name="bio"
                  rows={4}
                  maxLength={2000}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full border rounded-md px-3 py-2"
                />
                <div className="mt-1 text-xs text-gray-500">{bio.length}/2000</div>
              </div>
            </div>
          </>
        )}

        <div className="flex items-center justify-between">
          <Button
            type="submit"
            disabled={
              busy ||
              (isSignup && (usernameStatus === 'checking' || usernameStatus === 'taken'))
            }
          >
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
