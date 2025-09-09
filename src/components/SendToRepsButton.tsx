// src/components/SendToRepsButton.tsx
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import RepsSendModal from '@/components/RepsSendModal';
import { supabase } from '@/lib/supabase';

type Props = { prayerId: string; className?: string };

export default function SendToRepsButton({ prayerId, className }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const onClick = async () => {
    if (!user) {
      alert('Please sign in to send to your Congressman.');
      return;
    }

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

    setOpen(true);
  };

  return (
    <>
      <Button
        onClick={onClick}
        className={`self-start w-auto h-9 px-3 rounded-2xl ${className ?? ''}`}
      >
        Send to your Congressman
      </Button>
      {open && (
        <RepsSendModal
          prayerId={prayerId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
