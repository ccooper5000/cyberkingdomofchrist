import React from 'react';
import { Outlet } from 'react-router-dom';
import Navigation from '@/components/Navigation';
import { Toaster } from '@/components/ui/toaster';

export default function Layout() {
  return (
    <div className="min-h-[100dvh] bg-background">
  <Navigation />
  <main className="pt-[calc(4rem+var(--safe-area-top))]">
    <Outlet />
  </main>
  <Toaster />
</div>

  );
}