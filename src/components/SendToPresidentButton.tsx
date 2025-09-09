import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { outreach } from '@/lib/outreach';
import { supabase } from '@/lib/supabase';

type Props = {
  prayerId: string;
};

export default function SendToPresidentButton({ prayerId }: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (!user) {
      alert('Please sign in to send to the President.');
      return;
    }

    setBusy(true);
    try {
      // Owner check (defense-in-depth)
      const { data: p, error } = await supabase
        .from('prayers')
        .select('author_id')
        .eq('id', prayerId)
        .single();

      if (error || !p) {
        console.error('Ownership check failed:', error);
        alert('Unable to verify ownership. Please try again.');
        return;
      }
      if (p.author_id !== user.id) {
        alert('Only the prayer owner can send this prayer.');
        return;
      }

      const res = await outreach.enqueueToPresident({
        userId: user.id,
        prayerId,
        channels: ['email'], // can extend later
      });

      if (res.error) {
        console.error(res.error);
        alert('Could not enqueue outreach to President. Please try again.');
        return;
      }

      alert('Prayer queued for delivery to the President.');
    } catch (e) {
      console.error(e);
      alert('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      onClick={onClick}
      disabled={busy}
      variant="secondary"
      size="sm"
      className="self-start w-auto h-9 px-3 rounded-2xl"
    >
      {busy ? 'Sending…' : 'Send to President'}
    </Button>
  );
}
