import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

function partOfDay() {
  const h = new Date().getHours();
  return h >= 18 || h < 5 ? 'evening' : 'day';
}

export default function AuthMessages() {
  const [text, setText] = useState<string | null>(null);
  const [variant, setVariant] = useState<'in' | 'out'>('in');

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (event === 'SIGNED_IN' && session?.user) {
          const u = session.user;
          let display = u.email ?? 'Friend';
          // Try to use profile.username if present
          const { data } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', u.id)
            .maybeSingle();
          if (data?.username) display = data.username;

          localStorage.setItem('ckoc_last_display_name', display);
          setVariant('in');
          setText(`Welcome, ${display}.`);
        } else if (event === 'SIGNED_OUT') {
          const name = localStorage.getItem('ckoc_last_display_name') || 'Friend';
          setVariant('out');
          setText(`You are now signed out, ${name}. Have a blessed ${partOfDay()}.`);
        }
      } catch (e) {
        console.error('AuthMessages handler error:', e);
      } finally {
        // Auto-hide after a few seconds
        setTimeout(() => setText(null), 4500);
      }
    });

    return () => sub.subscription.unsubscribe();
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
