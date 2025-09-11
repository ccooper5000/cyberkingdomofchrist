// src/pages/Groups.tsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
};

export default function GroupsPage() {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 1) Load groups
        const { data: gData, error: gErr } = await supabase
          .from('groups')
          .select('id, name, description, created_by, created_at')
          .order('created_at', { ascending: false });

        if (gErr) throw gErr;
        if (!mounted) return;

        const rows = (gData ?? []) as GroupRow[];
        setGroups(rows);

        // 2) Member counts
        if (rows.length > 0) {
          const ids = rows.map((g) => g.id);
          const { data: mData, error: mErr } = await supabase
            .from('group_members')
            .select('group_id')
            .in('group_id', ids);

          if (mErr) throw mErr;
          if (!mounted) return;

          const counts: Record<string, number> = {};
          for (const { group_id } of (mData ?? []) as { group_id: string }[]) {
            counts[group_id] = (counts[group_id] || 0) + 1;
          }
          for (const id of ids) if (counts[id] == null) counts[id] = 0;
          setMemberCounts(counts);
        } else {
          setMemberCounts({});
        }
      } catch (e: any) {
        console.error('[GroupsPage] load error:', e);
        if (!mounted) return;
        setError(e?.message || 'Could not load groups.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen pt-24">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold">Groups</h1>
            <p className="text-sm text-gray-600">Find groups and see their member counts.</p>
          </div>
          <Button variant="outline" size="sm" disabled title="Coming soon">Create Group</Button>
        </div>

        {loading && <div className="text-sm text-gray-600">Loading…</div>}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {!loading && !error && groups.length === 0 && (
          <div className="text-sm text-gray-600">No groups yet.</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map((group) => (
            <Card key={group.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    <Link to={`/g/${group.id}`} className="underline decoration-dotted hover:decoration-solid">
                      {group.name}
                    </Link>
                  </CardTitle>
                  <Badge variant="secondary">Group</Badge>
                </div>
                {group.description && (
                  <CardDescription className="text-sm">{group.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center text-sm text-gray-700">
                    <Users className="h-4 w-4 mr-1" />
                    {memberCounts[group.id] ?? 0} members
                  </div>

                  {/* View link (use Button styling if your Button supports asChild; otherwise keep plain link) */}
                  <Link to={`/g/${group.id}`} className="text-sm underline">
                    View
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
