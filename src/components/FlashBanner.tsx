// src/components/FlashBanner.tsx
import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'

type Flash = {
  kind?: 'info' | 'success' | 'warning' | 'error' | 'welcome'
  text: string
  /** If provided, FlashBanner will show this message only once per browser session for this key. */
  onceKey?: string
}

const AUTO_DISMISS_MS = 4000
const SEEN_PREFIX = 'flash.seen.' // sessionStorage key prefix

export default function FlashBanner() {
  const location = useLocation()
  const navigate = useNavigate()
  const flash = (location.state as any)?.flash as Flash | undefined

  const [visible, setVisible] = useState<boolean>(!!flash)
  const [msg, setMsg] = useState<Flash | null>(flash || null)
  const timerRef = useRef<number | null>(null)

  // When route state changes, decide whether to show (respect onceKey)
  useEffect(() => {
    if (!flash?.text) return

    // If this flash carries a onceKey and we've already shown it this session, skip it and strip from history.
    if (flash.onceKey) {
      const seenKey = SEEN_PREFIX + flash.onceKey
      if (sessionStorage.getItem(seenKey) === '1') {
        stripFlashFromHistory()
        return
      }
      // Mark as seen immediately so re-mounts won't re-show it.
      sessionStorage.setItem(seenKey, '1')
    }

    setMsg(flash)
    setVisible(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.text, flash?.kind, flash?.onceKey])

  // Auto-dismiss after 3 seconds
  useEffect(() => {
    if (!visible) return
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      handleClose()
    }, AUTO_DISMISS_MS)
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [visible, msg?.text])

  function stripFlashFromHistory() {
    const currentState = (location.state as any) || {}
    if (currentState.flash) {
      const { flash: _omit, ...rest } = currentState
      navigate(location.pathname + location.search, { replace: true, state: rest })
    }
  }

  function handleClose() {
    setVisible(false)
    // Remove flash from history so it won't come back on remount/navigation
    stripFlashFromHistory()
  }

  if (!visible || !msg?.text) return null

  const base =
    'fixed right-4 top-[calc(4rem+var(--safe-area-top)+0.5rem)] z-[60] rounded-lg shadow-md border px-4 py-3 text-sm'
  const tone =
    msg.kind === 'success' || msg.kind === 'welcome'
      ? 'bg-green-50 border-green-200 text-green-800'
      : msg.kind === 'error'
      ? 'bg-red-50 border-red-200 text-red-800'
      : msg.kind === 'warning'
      ? 'bg-yellow-50 border-yellow-200 text-yellow-900'
      : 'bg-blue-50 border-blue-200 text-blue-900'

  return (
    <div className={`${base} ${tone}`} role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="pt-0.5">{msg.text}</div>
        <button
          aria-label="Dismiss"
          className="ml-auto opacity-70 hover:opacity-100"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
