// src/components/Navigation.tsx
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Users, Settings, DollarSign, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { auth } from '@/lib/supabase';
import FlashBanner from '@/components/FlashBanner';

export default function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  const navItems = [
    { href: '/feed', label: 'Feed', icon: Home },
    { href: '/groups', label: 'Groups', icon: Users },
    { href: '/circles', label: 'Circles', icon: Circle },
    { href: '/pricing', label: 'Pricing', icon: DollarSign },
    { href: '/settings', label: 'Profile', icon: Settings },
  ];

  const handleSignOut = async () => {
    setBusy(true);
    const { error } = await auth.signOut();
    setBusy(false);
    if (error) {
      console.error('Sign out error:', error);
      return;
    }
    navigate('/login', {
      replace: true,
      state: { flash: { kind: 'info', text: 'You have successfully logged out, have a blessed day.' } },
    });
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-america-gray shadow-sm">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link to="/feed" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-america rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">CK</span>
            </div>
            <span className="text-xl font-bold text-america-navy">CYBER KINGDOM OF CHRIST</span>
          </Link>

          <div className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                location.pathname === item.href ||
                location.pathname.startsWith(item.href + '/');
              return (
                <Link key={item.href} to={item.href}>
                  <Button
                    variant="ghost"
                    className={cn(
                      'flex items-center space-x-2',
                      isActive && 'bg-america-gray text-america-navy'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Button>
                </Link>
              );
            })}
          </div>

          <div className="flex items-center space-x-2">
            {loading ? (
              <Button variant="outline" size="sm" disabled>
                Loading…
              </Button>
            ) : user ? (
              <Button variant="outline" size="sm" onClick={handleSignOut} disabled={busy}>
                {busy ? 'Signing out…' : 'Sign Out'}
              </Button>
            ) : (
              <Link to="/login">
                <Button variant="outline" size="sm">Sign In</Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Flash banner (visible on pages where Navigation is mounted) */}
      <FlashBanner />
    </nav>
  );
}
