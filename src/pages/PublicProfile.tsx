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
  // visibility?: string | null; // optional if you want to inspect it
};

const PAGE_SIZE = 20;

export default function PublicProfile() {
  const { username } = useParams<{ username: string }>();

  // Profile state
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prayers state
  const [prayers, setPrayers] = useState<PublicPrayer[]>([]);
  const [prayersError, setPrayersError] = useState<string | null>(null);
  const [initialPrayersLoading, setInitialPrayersLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);

  // Load profile basics
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
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
    return () => {
      mounted = false;
    };
  }, [username]);

  const loadMore = useCallback(async () => {
    if (!profile?.id) return;

    const firstPage = nextOffset === 0;
    if (firstPage) {
      setInitialPrayersLoading(true);
      setPrayers([]);
      setPrayersError(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const { data, error } = await supabase
        .from('prayers')
        .select('id, author_id, content, category, created_at') // , visibility
        .eq('author_id', profile.id)
        // include both public and legacy (NULL) rows
        .or('visibility.eq.public,visibility.is.null')
        .order('created_at', { ascending: false })
        .range(nextOffset, nextOffset + PAGE_SIZE - 1);

      if (error) {
        console.error('[PublicProfile] prayers load error:', error);
        if (firstPage) {
          setPrayers([]);
          setPrayersError(error.message || 'Could not load prayers.');
        }
        setHasMore(false);
        return;
      }

      const rows = (data ?? []) as PublicPrayer[];

      setPrayers((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        for (const r of rows) {
          if (!seen.has(r.id)) merged.push(r);
        }
        return merged;
      });

      setNextOffset((n) => n + rows.length);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e) {
      console.error('[PublicProfile] prayers load exception:', e);
      if (firstPage) {
        setPrayers([]);
        setPrayersError('Could not load prayers.');
      }
      setHasMore(false);
    } finally {
      if (firstPage) {
        setInitialPrayersLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [profile?.id, nextOffset]);

  // Reset prayers and load first page whenever profile changes
  useEffect(() => {
    if (!profile?.id) return;
    setPrayers([]);
    setNextOffset(0);
    setHasMore(false);
    setPrayersError(null);
    loadMore();
  }, [profile?.id, loadMore]);

  if (loading) {
    return (
      <div className="min-h-screen pt-24">
        <div className="max-w-3xl mx-auto px-4">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen pt-24">
        <div className="max-w-3xl mx-auto px-4">
          <Card className="p-6">
            <div className="text-sm text-gray-700">{error}</div>
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

          {initialPrayersLoading && (
            <div className="text-sm text-gray-600">Loading prayers…</div>
          )}

          {prayersError && (
            <div className="text-sm text-red-600">{prayersError}</div>
          )}

          {!initialPrayersLoading && !prayersError && prayers.length === 0 && (
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

          {hasMore && !initialPrayersLoading && (
            <div className="pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
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
