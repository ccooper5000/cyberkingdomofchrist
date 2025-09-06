// src/components/SendToRepsButton.tsx
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import RepsSendModal from '@/components/RepsSendModal';

type Props = { prayerId: string; className?: string };

export default function SendToRepsButton({ prayerId, className }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const onClick = () => {
    if (!user) {
      alert('Please sign in to send to your Congressman.');
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <Button onClick={onClick} className="self-start w-auto h-9 px-3 rounded-2xl"
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
