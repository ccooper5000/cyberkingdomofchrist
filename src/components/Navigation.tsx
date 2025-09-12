// src/components/Navigation.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Users, Settings, DollarSign, Circle, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { auth } from '@/lib/supabase';
import FlashBanner from '@/components/FlashBanner';

function NavLinks({
  items,
  pathname,
  className = '',
  onNavigate,
}: {
  items: { href: string; label: string; icon: React.ComponentType<any> }[];
  pathname: string;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <div className={className}>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link key={item.href} to={item.href}>
            <Button
              variant="ghost"
              className={cn(
                'flex items-center space-x-2 w-full text-left',
                isActive && 'bg-america-gray text-america-navy'
              )}
              onClick={onNavigate}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Button>
          </Link>
        );
      })}
    </div>
  );
}

export default function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);

  // Mobile menu state
  const [mobileOpen, setMobileOpen] = useState(false);

  // Wrap the whole nav row so we can detect outside clicks
  const rowRef = useRef<HTMLDivElement | null>(null);

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
      state: {
        flash: {
          kind: 'info',
          text: 'You have successfully logged out, have a blessed day.',
        },
      },
    });
  };

  // Close mobile menu when the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close on outside click (no page-covering overlay)
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      if (!mobileOpen) return;
      const target = e.target as Node;
      if (rowRef.current && !rowRef.current.contains(target)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [mobileOpen]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-america-gray shadow-sm pt-[var(--safe-area-top)]">
      <div className="max-w-6xl mx-auto px-4">
        <div ref={rowRef} className="relative flex items-center justify-between h-16">
          {/* Brand */}
          <Link to="/feed" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-america rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">CK</span>
            </div>
            <span className="text-xl font-bold text-america-navy">
              CYBER KINGDOM OF CHRIST
            </span>
          </Link>

          {/* Desktop links */}
          <NavLinks
            items={navItems}
            pathname={location.pathname}
            className="hidden md:flex items-center space-x-1"
          />

          {/* Right actions + mobile hamburger */}
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

            {/* Hamburger (mobile only) */}
            <button
              type="button"
              aria-label="Toggle navigation"
              aria-controls="mobile-menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-300"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>

          {/* Mobile dropdown panel — compact popover sized to content */}
          {mobileOpen && (
            <div
              id="mobile-menu"
              className="md:hidden absolute right-2 top-[calc(100%+0.5rem)] z-50"
            >
              <div className="bg-white border shadow-md rounded-xl p-5 w-max max-w-[calc(100vw-1rem)]">
                <NavLinks
                  items={navItems}
                  pathname={location.pathname}
                  className="flex flex-col gap-1"
                  onNavigate={() => setMobileOpen(false)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Flash banner (visible on pages where Navigation is mounted) */}
      <FlashBanner />
    </nav>
  );
}
