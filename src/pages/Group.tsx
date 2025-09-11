// src/pages/Group.tsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fetchProfilesPublicByIds } from '@/lib/profileLookup';

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
};

type GroupPrayer = {
  id: string;
  author_id: string;
  content: string;
  category: string | null;
  created_at: string;
};

export default function GroupPage() {
  const { id } = useParams<{ id: string }>();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [groupError, setGroupError] = useState<string | null>(null);

  const [memberCount, setMemberCount] = useState<number>(0);

  const [prayers, setPrayers] = useState<GroupPrayer[]>([]);
  const [prayersLoading, setPrayersLoading] = useState(false);
  const [prayersError, setPrayersError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<
    Record<string, { username: string | null; is_public: boolean | null }>
  >({});

  // Load group header
  useEffect(() => {
    if (!id) return;
    let mounted = true;
    (async () => {
      setGroupLoading(true);
      setGroupError(null);
      try {
        const { data, error } = await supabase
          .from('groups')
          .select('id, name, description, created_by, created_at')
          .eq('id', id)
          .maybeSingle();

        if (!mounted) return;
        if (error) {
          setGroupError(error.message || 'Could not load group.');
          setGroup(null);
        } else if (!data) {
          setGroupError('Group not found.');
          setGroup(null);
        } else {
          setGroup(data as GroupRow);
        }
      } catch {
        if (!mounted) return;
        setGroupError('Could not load group.');
        setGroup(null);
      } finally {
        if (mounted) setGroupLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  // Load member count
  useEffect(() => {
    if (!id) return;
    let mounted = true;
    (async () => {
      // Use count-only query (exact) for efficiency
      const { count, error } = await supabase
        .from('group_members')
        .select('group_id', { count: 'exact', head: true })
        .eq('group_id', id);

      if (!mounted) return;
      if (error) {
        console.warn('[Group] member count error:', error);
        setMemberCount(0);
      } else {
        setMemberCount(count ?? 0);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  // Load group prayers (read-only)
  useEffect(() => {
    if (!id) return;
    let mounted = true;
    (async () => {
      setPrayersLoading(true);
      setPrayersError(null);
      try {
        const { data, error } = await supabase
          .from('prayers')
          .select('id, author_id, content, category, created_at')
          .eq('group_id', id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (!mounted) return;

        if (error) {
          setPrayers([]);
          setPrayersError(error.message || 'Could not load group prayers.');
          return;
        }

        const rows = (data ?? []) as GroupPrayer[];
        setPrayers(rows);

        // Prefetch author display info
        try {
          const ids = Array.from(new Set(rows.map((r) => r.author_id)));
          const map = await fetchProfilesPublicByIds(ids);
          if (mounted) setProfiles(map);
        } catch (e) {
          console.warn('[Group] profile prefetch skipped:', e);
        }
      } catch {
        if (!mounted) return;
        setPrayers([]);
        setPrayersError('Could not load group prayers.');
      } finally {
        if (mounted) setPrayersLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [id]);

  function PostedBy({ authorId }: { authorId: string }) {
    const info = profiles[authorId];
    const username = info?.username ?? 'Private user';
    const isPublic = !!info?.is_public && !!info?.username;
    return (
      <div className="text-[11px] text-gray-600">
        Posted by{' '}
        {isPublic ? (
          <Link to={`/u/${username}`} className="underline">
            {username}
          </Link>
        ) : (
          <span title="profile is private">{username}</span>
        )}
      </div>
    );
  }

  if (groupLoading) {
    return (
      <div className="min-h-screen pt-24">
        <div className="max-w-4xl mx-auto px-4">Loading…</div>
      </div>
    );
  }

  if (groupError) {
    return (
      <div className="min-h-screen pt-24">
        <div className="max-w-4xl mx-auto px-4">
          <Card className="p-6">
            <div className="text-sm text-gray-700">{groupError}</div>
            <div className="mt-4">
              <Link to="/groups" className="text-sm underline">
                Back to groups
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!group) return null;

  return (
    <div className="min-h-screen pt-24">
      <div className="max-w-4xl mx-auto px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{group.name}</h1>
            {group.description && (
              <p className="text-sm text-gray-600 mt-1">{group.description}</p>
            )}
            <div className="text-xs text-gray-500 mt-1">{memberCount} members</div>
          </div>
          {/* Join/Leave comes next step; placeholder only */}
          <Button variant="outline" size="sm" disabled title="Join/Leave coming soon">
            Join
          </Button>
        </div>

        {/* Prayers */}
        <div>
          <h2 className="text-base font-semibold mb-2">Group prayers</h2>

          {prayersLoading && (
            <div className="text-sm text-gray-600">Loading prayers…</div>
          )}
          {prayersError && (
            <div className="text-sm text-red-600">{prayersError}</div>
          )}
          {!prayersLoading && !prayersError && prayers.length === 0 && (
            <div className="text-sm text-gray-600">No prayers yet.</div>
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

                <div className="mt-2">
                  <PostedBy authorId={p.author_id} />
                </div>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <Link to="/groups" className="text-sm underline">
            ← Back to groups
          </Link>
        </div>
      </div>
    </div>
  );
}
