import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import FlashBanner from '@/components/FlashBanner';
import { Heart } from 'lucide-react';
import SendToRepsButton from '@/components/SendToRepsButton';
import SendToPresidentButton from '@/components/SendToPresidentButton';

/** Keep types simple & runtime-safe */
type FeedPrayer = {
  id: string;
  author_id: string;
  content: string;
  category: string | null;
  created_at: string;
};

type Category =
  | 'trump_politics'
  | 'health'
  | 'family'
  | 'business'
  | 'national'
  | 'custom';

type CommentRow = {
  id: string;
  prayer_id: string;
  author_id: string;
  content: string;
  created_at: string;
};

export default function Feed() {
  const { user } = useAuth();
  const [items, setItems] = useState<FeedPrayer[]>([]);
  const [loading, setLoading] = useState(true);

  // composer state
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<Category>('national');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('prayers')
          .select('id, author_id, content, category, created_at')
          .order('created_at', { ascending: false })
          .limit(50);
        if (!mounted) return;
        if (error) {
          console.error('Feed load error:', error);
          setItems([]);
        } else {
          setItems((data ?? []) as FeedPrayer[]);
        }
      } catch (e) {
        if (mounted) setItems([]);
        console.error('Feed load exception:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setPostError(null);

    if (!content.trim()) {
      setPostError('Please enter your prayer.');
      return;
    }

    setPosting(true);
    try {
      const { data, error } = await supabase
        .from('prayers')
        .insert({
          author_id: user.id,
          category,
          content: content.trim(),
          visibility: 'public',
          group_id: null,
          circle_id: null,
          is_featured: false,
        })
        .select('id, author_id, content, category, created_at')
        .single();

      if (error) {
        console.error('Post error:', error);
        setPostError(error.message || 'Could not post your prayer.');
        return;
      }

      if (data) {
        setItems((prev) => [data as FeedPrayer, ...prev]);
        setContent('');
        setCategory('national');
      }
    } catch (e) {
      console.error('Post exception:', e);
      setPostError('Could not post your prayer.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="min-h-screen pt-24">
      <FlashBanner />

      <div className="max-w-3xl mx-auto px-4 space-y-6">
        {/* Auth controls always visible based on user presence */}
        <div className="flex justify-end items-center gap-3">
          {!user ? (
            <Link to="/login" className="text-sm underline">Log in</Link>
          ) : (
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="text-sm underline"
            >
              Log out
            </button>
          )}
        </div>

        {/* Inline composer */}
        <div className="border rounded-2xl p-4 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Post a Prayer</h2>
            <Link to="/post" className="text-sm underline">
              Open full post page
            </Link>
          </div>

          {!user ? (
            <div className="text-sm text-gray-600">
              Please <Link to="/login" className="underline">log in</Link> to post a prayer.
            </div>
          ) : (
            <form onSubmit={handlePost} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1">
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                    className="w-full border rounded-md px-3 py-2"
                    disabled={!user || posting}
                  >
                    <option value="national">National</option>
                    <option value="family">Family</option>
                    <option value="health">Health</option>
                    <option value="business">Business</option>
                    <option value="trump_politics">President Trump/Politics</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">Your Prayer</label>
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="w-full border rounded-md px-3 py-2 min-h-[80px]"
                    maxLength={2000}
                    placeholder="Write your prayer here…"
                    disabled={!user || posting}
                  />
                  <div className="flex justify-between items-center text-xs text-gray-500 mt-1">
                    <span>{content.length}/2000</span>
                    {postError && <span className="text-red-600">{postError}</span>}
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={!user || posting}>
                  {posting ? 'Posting…' : 'Post Prayer'}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Feed list */}
        <div className="space-y-3">
          <h3 className="text-base font-semibold">Recent Prayers</h3>
          {loading ? (
            <div className="text-sm text-gray-600">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-gray-600">No prayers yet.</div>
          ) : (
            items.map((p) => (
              <div key={p.id} className="border rounded-xl p-4 bg-white shadow-sm">
                <div className="text-xs text-gray-500">
                  {new Date(p.created_at).toLocaleString()}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wide text-gray-600">
                  {String(p.category ?? 'uncategorized').replace('_', ' ')}
                </div>
                <p className="mt-2 whitespace-pre-wrap">{p.content}</p>

                {/* Actions */}
                <div className="mt-2 flex flex-col gap-2">
                  <LikeControl prayerId={p.id} />
                  {user?.id === p.author_id && (
                    <>
                      <SendToRepsButton prayerId={p.id} />
                      <SendToPresidentButton prayerId={p.id} />
                    </>
                  )}
                  <RepliesSection prayerId={p.id} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** LikeControl */
function LikeControl({ prayerId }: { prayerId: string }) {
  const { user } = useAuth();
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setErr(null);
      if (!user) return;
      const { data, error } = await supabase
        .from('prayer_likes')
        .select('prayer_id')
        .eq('prayer_id', prayerId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!mounted) return;
      if (error && error.code !== 'PGRST116') {
        console.error('Load like error:', error);
      }
      setLiked(!!data);
    })();
    return () => { mounted = false; };
  }, [prayerId, user?.id]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await (supabase as any).rpc('count_prayer_likes', {
        p_prayer_id: prayerId,
      });
      if (!mounted) return;
      if (!error) setCount((data as number) ?? 0);
    })();
    return () => { mounted = false; };
  }, [prayerId]);

  async function toggleLike() {
    if (!user) return;
    setBusy(true);
    setErr(null);

    if (!liked) {
      const { error } = await supabase.from('prayer_likes').upsert({
        prayer_id: prayerId,
        user_id: user.id,
      });
      setBusy(false);
      if (error) {
        console.error('Like error:', error);
        setErr(error.message || 'Could not like.');
        return;
      }
      setLiked(true);
      setCount((n) => n + 1);
    } else {
      const { error } = await supabase
        .from('prayer_likes')
        .delete()
        .eq('prayer_id', prayerId)
        .eq('user_id', user.id);
      setBusy(false);
      if (error) {
        console.error('Unlike error:', error);
        setErr(error.message || 'Could not unlike.');
        return;
      }
      setLiked(false);
      setCount((n) => Math.max(0, n - 1));
    }
  }

  if (!user) {
    return (
      <Link to="/login" className="text-sm underline">
        Like ({count}) — log in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={liked ? 'default' : 'outline'}
        size="sm"
        onClick={toggleLike}
        disabled={busy}
        className="flex items-center gap-2"
      >
        <Heart className="h-4 w-4" />
        {busy ? (liked ? 'Unliking…' : 'Liking…') : liked ? 'Unlike' : 'Like'}
      </Button>
      <span className="text-sm text-gray-700">{count}</span>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

/** RepliesSection */
function RepliesSection({ prayerId }: { prayerId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CommentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyCount, setReplyCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { count, error } = await supabase
        .from('prayer_comments')
        .select('id', { count: 'exact', head: true })
        .eq('prayer_id', prayerId);
      if (!mounted) return;
      if (!error) setReplyCount(count ?? 0);
    })();
    return () => { mounted = false; };
  }, [prayerId]);

  async function loadIfNeeded() {
    if (open && items.length > 0) return;
    if (!open) return;

    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('prayer_comments')
        .select('id, prayer_id, author_id, content, created_at')
        .eq('prayer_id', prayerId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        setError(error.message || 'Could not load replies.');
        setItems([]);
      } else {
        setItems((data ?? []) as CommentRow[]);
        if (replyCount === 0) setReplyCount((data ?? []).length);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    if (!content.trim()) {
      setError('Please write a reply.');
      return;
    }
    setError(null);
    setPosting(true);

    try {
      const { data, error } = await supabase
        .from('prayer_comments')
        .insert({
          prayer_id: prayerId,
          author_id: user.id,
          content: content.trim(),
        })
        .select('id, prayer_id, author_id, content, created_at')
        .single();

      if (error) {
        setError(error.message || 'Could not post your reply.');
        return;
      }

      if (data) {
        setItems((prev) => [data as CommentRow, ...prev]);
        setContent('');
        setReplyCount((n) => n + 1);
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t w-full">
      <button
        className="text-sm underline"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void loadIfNeeded();
        }}
      >
        {open ? `Hide Replies (${replyCount})` : `Show Replies (${replyCount})`}
      </button>

      {open && (
        <div className="mt-3 space-y-3 w-full">
          {!user ? (
            <div className="text-sm text-gray-600">
              Please <Link className="underline" to="/login">log in</Link> to reply.
            </div>
          ) : (
            <form onSubmit={handleReply} className="space-y-2 w-full">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full border rounded-md px-3 py-2 min-h-[60px]"
                maxLength={1000}
                placeholder="Write a reply…"
                disabled={posting}
              />
              <div className="flex justify-between items-center text-xs text-gray-500">
                <span>{content.length}/1000</span>
                {error && <span className="text-red-600">{error}</span>}
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={posting}>
                  {posting ? 'Posting…' : 'Reply'}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="text-sm text-gray-600">Loading replies…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-gray-600">No replies yet.</div>
          ) : (
            <div className="space-y-2">
              {items.map((c) => (
                <div key={c.id} className="bg-gray-50 border rounded-lg p-2">
                  <div className="text-[11px] text-gray-500">
                    {new Date(c.created_at).toLocaleString()}
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{c.content}</p>
                  <CommentLikeControl commentId={c.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** CommentLikeControl */
function CommentLikeControl({ commentId }: { commentId: string }) {
  const { user } = useAuth();
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setErr(null);
      if (!user) return;
      const { data, error } = await (supabase as any)
        .from('comment_likes')
        .select('comment_id')
        .eq('comment_id', commentId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!mounted) return;
      if (error && error.code !== 'PGRST116') {
        console.error('Load comment like error:', error);
      }
      setLiked(!!data);
    })();
    return () => { mounted = false; };
  }, [commentId, user?.id]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await (supabase as any).rpc('count_comment_likes', {
        p_comment_id: commentId,
      });
      if (!mounted) return;
      if (!error) setCount((data as number) ?? 0);
    })();
    return () => { mounted = false; };
  }, [commentId]);

  async function toggleLike() {
    if (!user) return;
    setBusy(true);
    setErr(null);

    if (!liked) {
      const { error } = await (supabase as any).from('comment_likes').upsert({
        comment_id: commentId,
        user_id: user.id,
      });
      setBusy(false);
      if (error) {
        console.error('Comment like error:', error);
        setErr(error.message || 'Could not like.');
        return;
      }
      setLiked(true);
      setCount((n) => n + 1);
    } else {
      const { error } = await (supabase as any)
        .from('comment_likes')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_id', user.id);
      setBusy(false);
      if (error) {
        console.error('Comment unlike error:', error);
        setErr(error.message || 'Could not unlike.');
        return;
      }
      setLiked(false);
      setCount((n) => Math.max(0, n - 1));
    }
  }

  if (!user) {
    return (
      <div className="mt-2">
        <Link to="/login" className="text-xs underline">
          Like ({count}) — log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Button
        type="button"
        variant={liked ? 'default' : 'outline'}
        size="sm"
        onClick={toggleLike}
        disabled={busy}
        className="flex items-center gap-2"
      >
        <Heart className="h-4 w-4" />
        {busy ? (liked ? 'Unliking…' : 'Liking…') : liked ? 'Unlike' : 'Like'}
      </Button>
      <span className="text-sm text-gray-700">{count}</span>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
