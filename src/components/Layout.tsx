import React from 'react';
import { Outlet } from 'react-router-dom';
import Navigation from '@/components/Navigation';
import { Toaster } from '@/components/ui/toaster';

export default function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="pt-16">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}