import React, { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type Profile = { username: string | null; avatar_url: string | null };

export default function UserAvatarChip() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!user) { setProfile(null); return; }
      const { data } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (mounted) setProfile((data as Profile) ?? { username: null, avatar_url: null });
    }
    load();
    return () => { mounted = false; };
  }, [user?.id]);

  if (!user) return null;

  const name =
    profile?.username ||
    (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) ||
    user.email ||
    'User';

  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-white shadow-sm border">
      <Avatar className="h-7 w-7">
        <AvatarImage src={profile?.avatar_url ?? undefined} />
        <AvatarFallback>{(name[0] || 'U').toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="text-sm text-gray-800 max-w-[160px] truncate" title={`Logged in as ${name}`}>
        {name}
      </span>
      <span className="h-2 w-2 rounded-full bg-emerald-500" title="Online" />
    </div>
  );
}
