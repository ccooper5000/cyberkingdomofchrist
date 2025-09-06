import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

type Category =
  | 'trump_politics'
  | 'health'
  | 'family'
  | 'business'
  | 'national'
  | 'custom';

export default function PostPrayer() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [content, setContent] = useState('');
  const [category, setCategory] = useState<Category>('national');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full border rounded-xl p-6 shadow-sm space-y-4 bg-white">
          <h1 className="text-xl font-semibold">Post a Prayer</h1>
          <p className="text-sm text-gray-600">
            You need to be signed in to post a prayer.
          </p>
          <div className="flex gap-2">
            <Link to="/login">
              <Button>Go to Login</Button>
            </Link>
            <Link to="/feed">
              <Button variant="outline">Back to Feed</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!content.trim()) {
      setError('Please enter your prayer.');
      return;
    }

    try {
      setBusy(true);
      // Insert and ask PostgREST to return the row so we surface errors cleanly.
      const { error } = await supabase
        .from('prayers')
        .insert({
          author_id: user.id,
          category,
          content: content.trim(),
          visibility: 'public', // MVP: public visibility
          group_id: null,
          circle_id: null,
          is_featured: false,
        })
        .select('id')
        .single();

      setBusy(false);

      if (error) {
        setError(error.message || 'Could not post your prayer.');
        return;
      }

      // Redirect back to feed with a success flash message.
      navigate('/feed', {
        replace: true,
        state: { flash: { kind: 'success', text: 'Prayer posted. 🙏' } },
      });
    } catch (err: any) {
      setBusy(false);
      setError(err?.message || 'Unexpected error while posting.');
    }
  };

  return (
    <div className="min-h-screen flex items-start justify-center p-6 pt-24">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xl space-y-5 border rounded-2xl p-6 shadow-sm bg-white"
      >
        <h1 className="text-2xl font-bold">Post a Prayer</h1>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="w-full border rounded-md px-3 py-2"
          >
            <option value="national">National</option>
            <option value="family">Family</option>
            <option value="health">Health</option>
            <option value="business">Business</option>
            <option value="trump_politics">President Trump/Politics</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Your Prayer</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full border rounded-md px-3 py-2 min-h-[140px]"
            maxLength={2000}
            placeholder="Write your prayer here…"
            required
          />
          <div className="text-xs text-gray-500 text-right">
            {content.length}/2000
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Posting…' : 'Post Prayer'}
          </Button>
          <Link to="/feed">
            <Button variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
