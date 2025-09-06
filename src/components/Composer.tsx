import React, { useState } from 'react';
import { Send, Image, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Prayer } from '@/types/database';

interface ComposerProps {
  onPrayerCreated: (prayer: Prayer) => void;
}

export default function Composer({ onPrayerCreated }: ComposerProps) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) return;

    setIsSubmitting(true);
    
    // Placeholder for prayer creation logic
    try {
      // const { data, error } = await supabase.from('prayers').insert({...});
      console.log('Creating prayer:', { content, category });
      
      // Mock success
      setTimeout(() => {
        setContent('');
        setCategory('general');
        setIsSubmitting(false);
      }, 1000);
    } catch (error) {
      console.error('Error creating prayer:', error);
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-4">
          <Textarea
            placeholder="Share a prayer request or testimony..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[100px] resize-none border-america-gray focus:border-america-navy"
          />
          
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="healing">Healing</SelectItem>
                  <SelectItem value="guidance">Guidance</SelectItem>
                  <SelectItem value="gratitude">Gratitude</SelectItem>
                  <SelectItem value="family">Family</SelectItem>
                </SelectContent>
              </Select>
              
              <Button variant="ghost" size="icon" disabled>
                <Image className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" disabled>
                <MapPin className="h-4 w-4" />
              </Button>
            </div>
            
            <Button
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting}
              className="america-button"
            >
              <Send className="h-4 w-4 mr-2" />
              {isSubmitting ? 'Posting...' : 'Post Prayer'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}