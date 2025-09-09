import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

function partOfDay() {
  const h = new Date().getHours();
  return h >= 18 || h < 5 ? 'evening' : 'day';
}

export default function AuthMessages() {
  const [text, setText] = useState<string | null>(null);
  const [variant, setVariant] = useState<'in' | 'out'>('in');
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    // IMPORTANT: non-async listener, no DB calls, robust cleanup
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // clear any pending hide
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }

      if (event === 'SIGNED_IN' && session?.user) {
        const u = session.user;
        // Prefer user_metadata names; fall back to email; cache for logout message
        const display =
          (u.user_metadata && (u.user_metadata.username || u.user_metadata.full_name || u.user_metadata.name)) ||
          u.email ||
          'Friend';
        try {
          localStorage.setItem('ckoc_last_display_name', display);
        } catch {}
        setVariant('in');
        setText(`Welcome, ${display}.`);
        hideTimer.current = window.setTimeout(() => setText(null), 4500) as unknown as number;
      }

      if (event === 'SIGNED_OUT') {
        let name = 'Friend';
        try {
          name = localStorage.getItem('ckoc_last_display_name') || 'Friend';
        } catch {}
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
