import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

function partOfDay() {
  const h = new Date().getHours();
  return h >= 18 || h < 5 ? 'evening' : 'day';
}

function getDisplayName(u: any): string {
  const m = u?.user_metadata || {};
  return m.username || m.full_name || m.name || u?.email || 'Friend';
}

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch {}
}

export default function AuthMessages() {
  const [text, setText] = useState<string | null>(null);
  const [variant, setVariant] = useState<'in' | 'out'>('in');
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // clear any pending hide
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      const lastState = lsGet('ckoc_last_auth_state'); // 'signed_in' | 'signed_out' | null

      if (event === 'SIGNED_IN' && session?.user) {
        const name = getDisplayName(session.user);
        lsSet('ckoc_last_display_name', name);
        lsSet('ckoc_last_auth_state', 'signed_in');
        setVariant('in');
        setText(`Welcome, ${name}.`);
        hideTimer.current = window.setTimeout(() => setText(null), 4500) as unknown as number;
      }

      // When the page mounts after a login redirect, we get INITIAL_SESSION (not SIGNED_IN)
      if (event === 'INITIAL_SESSION') {
        if (session?.user) {
          const name = getDisplayName(session.user);
          lsSet('ckoc_last_display_name', name);
          // Only show Welcome if we weren't already signed in previously
          if (lastState !== 'signed_in') {
            setVariant('in');
            setText(`Welcome, ${name}.`);
            hideTimer.current = window.setTimeout(() => setText(null), 4500) as unknown as number;
          }
          lsSet('ckoc_last_auth_state', 'signed_in');
        } else {
          lsSet('ckoc_last_auth_state', 'signed_out');
        }
      }

      if (event === 'SIGNED_OUT') {
        const name = lsGet('ckoc_last_display_name') || 'Friend';
        lsSet('ckoc_last_auth_state', 'signed_out');
        setVariant('out');
        setText(`You are now signed out, ${name}. Have a blessed ${partOfDay()}.`);
        hideTimer.current = window.setTimeout(() => setText(null), 4500) as unknown as number;
      }
    });

    return () => {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      subscription?.unsubscribe();
    };
  }, []);

  if (!text) return null;

  return (
    <div className="fixed top-16 inset-x-0 z-[1000] flex justify-center pointer-events-none">
      <div
        className={`pointer-events-auto px-4 py-2 rounded-full shadow-lg text-white ${
          variant === 'in' ? 'bg-emerald-600' : 'bg-slate-700'
        }`}
        role="status"
      >
        {text}
      </div>
    </div>
  );
}
