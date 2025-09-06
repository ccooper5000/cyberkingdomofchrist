import React from 'react';
import { Share2, Copy, ExternalLink } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface ShareMenuProps {
  prayerId: string;
}

export default function ShareMenu({ prayerId }: ShareMenuProps) {
  const { toast } = useToast();

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/prayer/${prayerId}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: "Link copied!",
      description: "Prayer link has been copied to your clipboard.",
    });
  };

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({
        title: 'Prayer from CYBERKINGDOM',
        url: `${window.location.origin}/prayer/${prayerId}`,
      });
    } else {
      handleCopyLink();
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="text-america-gray-dark hover:text-america-navy">
          <Share2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleShare}>
          <ExternalLink className="h-4 w-4 mr-2" />
          Share Prayer
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyLink}>
          <Copy className="h-4 w-4 mr-2" />
          Copy Link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}