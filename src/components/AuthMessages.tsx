import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { supabase as sb } from '@/lib/supabase';

function dayOrEvening(d: Date) {
  const h = d.getHours();
  return h >= 18 || h < 5 ? 'evening' : 'day';
}

export default function AuthMessages() {
  const { user } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<'in' | 'out'>('in');

  useEffect(() => {
    const sub = sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const uid = session.user.id;
        let display = session.user.email ?? 'User';
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', uid)
          .maybeSingle();
        if (data?.username) display = data.username;
        localStorage.setItem('ckoc_last_display_name', display);
        setVariant('in');
        setMsg(`Welcome, ${display}.`);
        setTimeout(() => setMsg(null), 4000);
      } else if (event === 'SIGNED_OUT') {
        const name = localStorage.getItem('ckoc_last_display_name') || 'Friend';
        const when = dayOrEvening(new Date());
        setVariant('out');
        setMsg(`You are now signed out, ${name}. Have a blessed ${when}.`);
        setTimeout(() => setMsg(null), 4500);
      }
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);

  // also update cached name on first mount if already signed in
  useEffect(() => {
    if (user?.email) {
      const cached = localStorage.getItem('ckoc_last_display_name');
      if (!cached) localStorage.setItem('ckoc_last_display_name', user.email);
    }
  }, [user?.id]);

  if (!msg) return null;

  return (
    <div className="fixed top-16 inset-x-0 z-[1000] flex justify-center pointer-events-none">
      <div
        className={`pointer-events-auto px-4 py-2 rounded-full shadow-lg text-white ${
          variant === 'in' ? 'bg-emerald-600' : 'bg-slate-700'
        }`}
        role="status"
      >
        {msg}
      </div>
    </div>
  );
}
