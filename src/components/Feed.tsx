import React from 'react';
import PrayerCard from '@/components/PrayerCard';
import type { Prayer } from '@/types/database';

interface FeedProps {
  prayers: Prayer[];
}

export default function Feed({ prayers }: FeedProps) {
  if (prayers.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-america-gray-dark text-lg">
          No prayers yet. Be the first to share a prayer request!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {prayers.map((prayer) => (
        <PrayerCard key={prayer.id} prayer={prayer} />
      ))}
    </div>
  );
}