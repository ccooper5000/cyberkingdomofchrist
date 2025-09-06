import React from 'react';
import { Crown, Star, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TierPillProps {
  tier: 'basic' | 'premium' | 'leader';
  className?: string;
}

export default function TierPill({ tier, className }: TierPillProps) {
  const configs = {
    basic: {
      label: 'Believer',
      icon: Star,
      className: 'bg-gray-100 text-gray-700',
    },
    premium: {
      label: 'Disciple',
      icon: Crown,
      className: 'bg-america-red text-white',
    },
    leader: {
      label: 'Shepherd',
      icon: Shield,
      className: 'bg-america-navy text-white',
    },
  };

  const config = configs[tier];
  const Icon = config.icon;

  return (
    <div className={cn('tier-pill', config.className, className)}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </div>
  );
}