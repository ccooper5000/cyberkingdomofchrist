// src/pages/CreateGroup.tsx
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function CreateGroup() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Group name is required.');
      return;
    }
    if (trimmed.length > 80) {
      setError('Group name must be 80 characters or less.');
      return;
    }
    if (description.length > 300) {
      setError('Description must be 300 characters or less.');
      return;
    }

    setSubmitting(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) {
        navigate('/login');
        return;
      }

      // 1) Insert group (creator = current user)
      const { data: gData, error: gErr } = await supabase
        .from('groups')
        .insert({ name: trimmed, description: description || null, created_by: userId })
        .select('id')
        .single();

      if (gErr) throw gErr;
      const groupId = gData!.id as string;

      // 2) Add creator as owner member (self-scoped insert; allowed by RLS)
      const { error: mErr } = await supabase
        .from('group_members')
        .insert({ group_id: groupId, user_id: userId, role: 'owner' });

      if (mErr) {
        // Non-fatal: group is created even if membership insert fails.
        console.warn('[CreateGroup] membership insert warning:', mErr);
      }

      // 3) Navigate to the new group
      navigate(`/g/${groupId}`);
    } catch (e: any) {
      console.error('[CreateGroup] submit error:', e);
      setError(e?.message || 'Could not create group.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pt-24">
      <div className="max-w-lg mx-auto px-4">
        <Card className="p-6">
          <h1 className="text-xl font-semibold mb-4">Create a Group</h1>

          {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Group name</label>
              <input
                type="text"
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., General Prayer Circle"
                maxLength={80}
                required
              />
              <div className="text-xs text-gray-500 mt-1">{name.length}/80</div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <textarea
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What’s this group about?"
                maxLength={300}
                rows={4}
              />
              <div className="text-xs text-gray-500 mt-1">{description.length}/300</div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Group'}
              </Button>
              <Link to="/groups" className="text-sm underline">
                Cancel
              </Link>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
