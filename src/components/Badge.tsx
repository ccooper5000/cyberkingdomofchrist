import React from 'react';
import { Badge as UiBadge } from '@/components/ui/badge';

interface BadgeProps {
  type: string;
  className?: string;
}

export default function Badge({ type, className }: BadgeProps) {
  const getVariant = (type: string) => {
    switch (type) {
      case 'urgent':
        return 'destructive';
      case 'answered':
        return 'secondary';
      case 'healing':
        return 'default';
      default:
        return 'outline';
    }
  };

  return (
    <UiBadge variant={getVariant(type)} className={className}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </UiBadge>
  );
}