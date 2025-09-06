import React, { useState } from 'react';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LikeButtonProps {
  prayerId: string;
  initialLikes: number;
  className?: string;
}

export default function LikeButton({ prayerId, initialLikes, className }: LikeButtonProps) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikes);
  const [isLoading, setIsLoading] = useState(false);

  const handleLike = async () => {
    if (isLoading) return;

    setIsLoading(true);
    const newLikedState = !liked;
    const newCount = newLikedState ? likeCount + 1 : likeCount - 1;

    setLiked(newLikedState);
    setLikeCount(newCount);

    try {
      // Placeholder for like logic
      // await supabase.from('prayer_likes').insert/delete
      console.log(`${newLikedState ? 'Liked' : 'Unliked'} prayer:`, prayerId);
    } catch (error) {
      // Revert on error
      setLiked(!newLikedState);
      setLikeCount(likeCount);
      console.error('Error updating like:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLike}
      disabled={isLoading}
      className={cn(
        "text-america-gray-dark hover:text-america-red",
        liked && "text-america-red",
        className
      )}
    >
      <Heart className={cn("h-4 w-4 mr-2", liked && "fill-current")} />
      {likeCount > 0 && <span>{likeCount}</span>}
    </Button>
  );
}