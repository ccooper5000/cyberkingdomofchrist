import React from 'react';
import { MoreHorizontal, MessageCircle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import LikeButton from '@/components/LikeButton';
import ShareMenu from '@/components/ShareMenu';
import Badge from '@/components/Badge';
import SendToRepsButton from '@/components/SendToRepsButton';
import type { Database } from '@/types/database';
import { useAuth } from '@/hooks/useAuth';

// Extend DB row with the extra fields this UI renders.
type PrayerRow = Database['public']['Tables']['prayers']['Row'];
type AuthorStub = { username: string | null; avatar_url: string | null } | null;
type PrayerWithExtras = PrayerRow & {
  author?: AuthorStub;
  prayer_count?: number | null;
};

interface PrayerCardProps {
  prayer: PrayerWithExtras;
}

export default function PrayerCard({ prayer }: PrayerCardProps) {
  const { user } = useAuth();

  return (
    <Card className="prayer-card relative">

      {/* Owner-only diagnostic wrapper (renders only for the author) */}
      {user?.id === prayer.author_id && (
        <div className="absolute top-2 right-2 z-[9999] pointer-events-auto">
          <div className="mb-1 text-xs bg-yellow-300 text-black font-bold px-2 py-0.5 rounded ring-2 ring-black">
            DEBUG • Button Area
          </div>
          <SendToRepsButton prayerId={prayer.id} className="shadow-2xl" />
        </div>
      )}

      {/* Owner-only: primary send button */}
      {user?.id === prayer.author_id && (
        <div className="absolute top-3 right-3 z-10">
          <SendToRepsButton prayerId={prayer.id} />
        </div>
      )}

      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={prayer.author?.avatar_url ?? undefined} />
              <AvatarFallback className="bg-america-navy text-white">
                {prayer.author?.username?.[0]?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-america-text">
                {prayer.author?.username || 'Anonymous'}
              </p>
              <p className="text-sm text-america-gray-dark">
                {new Date(prayer.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Badge type={prayer.category as any} />
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <p className="text-america-text mb-4">{prayer.content}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <LikeButton
              prayerId={prayer.id}
              initialLikes={prayer.prayer_count ?? 0}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-america-gray-dark hover:text-america-navy"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Comment
            </Button>
          </div>
          <ShareMenu prayerId={prayer.id} />
        </div>
      </CardContent>
    </Card>
  );
}
