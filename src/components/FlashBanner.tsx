import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type Flash = { kind?: 'success' | 'info' | 'error'; text: string };

export default function FlashBanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const [flash, setFlash] = useState<Flash | null>(null);

  useEffect(() => {
    const state = (location.state as any) || {};
    if (state.flash) {
      const f: Flash = state.flash;
      setFlash(f);

      // Remove the flash from history state so it doesn't reappear on back/refresh
      const { flash: _omit, ...rest } = state;
      navigate(location.pathname + location.search, { replace: true, state: rest });

      const t = setTimeout(() => setFlash(null), 3000);
      return () => clearTimeout(t);
    }
  }, [location.key]); // run on navigation changes

  if (!flash) return null;

  const color =
    flash.kind === 'error'
      ? 'border-red-300 bg-red-50 text-red-800'
      : flash.kind === 'info'
      ? 'border-blue-300 bg-blue-50 text-blue-800'
      : 'border-green-300 bg-green-50 text-green-800';

  return (
    <div className="fixed top-16 right-4 z-[60]">
      <div className={`px-4 py-2 rounded-lg shadow border ${color}`}>
        {flash.text}
      </div>
    </div>
  );
}
