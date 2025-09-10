// src/pages/PublicProfile.tsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type ProfileView = {
  id: string;
  username: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_public: boolean;
  created_at: string;
};

export default function PublicProfile() {
  const { username } = useParams<{ username: string }>();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, display_name, first_name, last_name, bio, avatar_url, is_public, created_at')
          .eq('username', username as string)
          .maybeSingle();

        if (!mounted) return;

        if (error) {
          setError(error.message || 'Could not load profile.');
          setProfile(null);
        } else if (!data) {
          setError('Profile not found.');
          setProfile(null);
        } else if (!data.is_public) {
          setError('This profile is private.');
          setProfile(null);
        } else {
          setProfile(data as ProfileView);
        }
      } catch {
        if (!mounted) return;
        setError('Could not load profile.');
        setProfile(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [username]);

  if (loading) {
    return <div className="min-h-screen pt-24"><div className="max-w-3xl mx-auto px-4">Loading…</div></div>;
  }

  if (error) {
    return (
      <div className="min-h-screen pt-24">
        <div className="max-w-3xl mx-auto px-4">
          <Card className="p-6">
            <div className="text-sm text-gray-700">{error}</div>
            <div className="mt-4">
              <Link to="/" className="text-sm underline">Back to feed</Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const name =
    profile.display_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
    profile.username;

  return (
    <div className="min-h-screen pt-24">
      <div className="max-w-3xl mx-auto px-4 space-y-4">
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.username} className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="h-14 w-14 rounded-full bg-gray-200" />
          )}
          <div>
            <h1 className="text-xl font-semibold">{name}</h1>
            <div className="text-sm text-gray-600">@{profile.username}</div>
          </div>
        </div>

        {profile.bio && (
          <Card className="p-6">
            <div className="whitespace-pre-wrap text-sm">{profile.bio}</div>
          </Card>
        )}

        <div>
          <Link to="/" className="text-sm underline">← Back to feed</Link>
        </div>
      </div>
    </div>
  );
}
