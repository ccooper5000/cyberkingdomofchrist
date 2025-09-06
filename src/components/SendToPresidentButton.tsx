import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { outreach } from '@/lib/outreach';

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
    try {
      setBusy(true);
      const res = await outreach.enqueueToPresident({
        userId: user.id,
        prayerId,
        channels: ['email'], // can extend later
      });
      setBusy(false);

      if (res.error) {
        console.error(res.error);
        alert('Could not enqueue outreach to President. Please try again.');
        return;
      }
      alert('Prayer queued for delivery to the President.');
    } catch (e) {
      console.error(e);
      setBusy(false);
      alert('Something went wrong. Please try again.');
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
