// src/pages/PublicProfile.tsx
import React, { useEffect, useState, useCallback } from 'react';
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

type PublicPrayer = {
  id: string;
  author_id: string;
  content: string;
  category: string | null;
  created_at: string;
  // visibility?: string | null;
};

const PAGE_SIZE = 20;

export default function PublicProfile() {
  const { username } = useParams<{ username: string }>();

  // Profile state
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Prayers state
  const [prayers, setPrayers] = useState<PublicPrayer[]>([]);
  const [prayersLoading, setPrayersLoading] = useState(false);
  const [prayersError, setPrayersError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null); // last item's created_at

  // Load profile basics
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingProfile(true);
      setProfileError(null);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, username, display_name, first_name, last_name, bio, avatar_url, is_public, created_at'
          )
          .eq('username', username as string)
          .maybeSingle();

        if (!mounted) return;

        if (error) {
          setProfileError(error.message || 'Could not load profile.');
          setProfile(null);
        } else if (!data) {
          setProfileError('Profile not found.');
          setProfile(null);
        } else if (!data.is_public) {
          setProfileError('This profile is private.');
          setProfile(null);
        } else {
          setProfile(data as ProfileView);
        }
      } catch (e) {
        if (!mounted) return;
        setProfileError('Could not load profile.');
        setProfile(null);
      } finally {
        if (mounted) setLoadingProfile(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [username]);

  // Load first page or next page (keyset pagination by created_at)
  const loadPage = useCallback(
    async (mode: 'first' | 'next') => {
      if (!profile?.id) return;
      setPrayersLoading(true);
      setPrayersError(null);

      try {
        let q = supabase
          .from('prayers')
          .select('id, author_id, content, category, created_at') // , visibility
          .eq('author_id', profile.id)
          // allow public and legacy (NULL) rows
          .or('visibility.eq.public,visibility.is.null')
          .order('created_at', { ascending: false });

        if (mode === 'next' && cursor) {
          q = q.lt('created_at', cursor);
        }

        q = q.limit(PAGE_SIZE);

        const { data, error } = await q;
        if (error) {
          console.error('[PublicProfile] prayers error:', error);
          setPrayersError(error.message || 'Could not load prayers.');
          setHasMore(false);
          return;
        }

        const rows = (data ?? []) as PublicPrayer[];

        if (mode === 'first') {
          setPrayers(rows);
        } else {
          setPrayers((prev) => [...prev, ...rows]);
        }

        // Update cursor to the last item (if any)
        if (rows.length > 0) {
          setCursor(rows[rows.length - 1].created_at);
        }

        setHasMore(rows.length === PAGE_SIZE);
      } catch (e) {
        console.error('[PublicProfile] prayers exception:', e);
        setPrayersError('Could not load prayers.');
        setHasMore(false);
      } finally {
        setPrayersLoading(false);
      }
    },
    [profile?.id, cursor]
  );

  // Reset & load first page when profile changes
  useEffect(() => {
    if (!profile?.id) return;
    setPrayers([]);
    setCursor(null);
    setHasMore(false);
    setPrayersError(null);
    // Load the first page
    loadPage('first');
  }, [profile?.id, loadPage]);

  if (loadingProfile) {
    return (
      <div className="min-h-screen pt-24">
        <div className="max-w-3xl mx-auto px-4">Loading…</div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="min-h-screen pt-24">
        <div className="max-w-3xl mx-auto px-4">
          <Card className="p-6">
            <div className="text-sm text-gray-700">{profileError}</div>
            <div className="mt-4">
              <Link to="/" className="text-sm underline">
                Back to feed
              </Link>
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
      <div className="max-w-3xl mx-auto px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.username}
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-gray-200" />
          )}
          <div>
            <h1 className="text-xl font-semibold">{name}</h1>
            <div className="text-sm text-gray-600">@{profile.username}</div>
          </div>
        </div>

        {/* Bio */}
        {profile.bio && (
          <Card className="p-6">
            <div className="whitespace-pre-wrap text-sm">{profile.bio}</div>
          </Card>
        )}

        {/* Prayers */}
        <div>
          <h2 className="text-base font-semibold mb-2">Prayers</h2>

          {prayersLoading && prayers.length === 0 && (
            <div className="text-sm text-gray-600">Loading prayers…</div>
          )}

          {prayersError && (
            <div className="text-sm text-red-600">{prayersError}</div>
          )}

          {!prayersLoading && !prayersError && prayers.length === 0 && (
            <div className="text-sm text-gray-600">No public prayers yet.</div>
          )}

          <div className="space-y-3">
            {prayers.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="text-xs text-gray-500">
                  {new Date(p.created_at).toLocaleString()}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-gray-600">
                  {String(p.category ?? 'uncategorized').replace('_', ' ')}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{p.content}</p>
              </Card>
            ))}
          </div>

          {hasMore && (
            <div className="pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => loadPage('next')}
                disabled={prayersLoading}
              >
                {prayersLoading ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>

        {/* Back link */}
        <div>
          <Link to="/" className="text-sm underline">
            ← Back to feed
          </Link>
        </div>
      </div>
    </div>
  );
}
