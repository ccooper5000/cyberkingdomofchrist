import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('Finishing sign-in…')

  const parsed = useMemo(() => {
    const url = new URL(window.location.href)
    const qs = url.searchParams
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
    return {
      code: qs.get('code') || hash.get('code'),
      hasTokensInHash: hash.has('access_token') || hash.has('refresh_token'),
      clear: () => window.history.replaceState({}, '', url.pathname),
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        if (parsed.code) {
          await supabase.auth.exchangeCodeForSession(parsed.code)
          parsed.clear()
          navigate('/feed', { replace: true })
          return
        }
        if (parsed.hasTokensInHash) {
          parsed.clear()
          navigate('/feed', { replace: true })
          return
        }
        setMessage('Email confirmed! You can now sign in.')
      } catch (e: any) {
        setError(e?.message || 'Could not complete sign-in.')
      }
    })()
  }, [navigate, parsed])

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[50vh]">
      {!error ? (
        <>
          <p className="mb-4">{message}</p>
          {message.includes('sign in') && (
            <button
              className="rounded bg-blue-600 text-white px-4 py-2"
              onClick={() => navigate('/login', { replace: true })}
            >
              Go to sign in
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-red-600 mb-4">Error: {error}</p>
          <button
            className="rounded bg-blue-600 text-white px-4 py-2"
            onClick={() => navigate('/login', { replace: true })}
          >
            Back to sign in
          </button>
        </>
      )}
    </div>
  )
}
