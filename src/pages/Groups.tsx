import React from 'react';
import { Plus, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function GroupsPage() {
  // Placeholder data
  const groups = [
    {
      id: '1',
      name: 'Youth Ministry',
      description: 'Young adults growing in faith together',
      memberCount: 47,
      isPrivate: false,
    },
    {
      id: '2',
      name: 'Prayer Warriors',
      description: 'Dedicated to intercessory prayer',
      memberCount: 123,
      isPrivate: true,
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-america-text mb-2">Groups</h1>
          <p className="text-america-gray-dark">Connect with believers who share your interests</p>
        </div>
        <Button className="america-button">
          <Plus className="h-4 w-4 mr-2" />
          Create Group
        </Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {groups.map((group) => (
          <Card key={group.id} className="hover:shadow-md transition-shadow duration-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-america-navy">{group.name}</CardTitle>
                <Badge variant={group.isPrivate ? 'secondary' : 'default'}>
                  {group.isPrivate ? 'Private' : 'Public'}
                </Badge>
              </div>
              <CardDescription>{group.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center text-sm text-america-gray-dark">
                  <Users className="h-4 w-4 mr-1" />
                  {group.memberCount} members
                </div>
                <Button variant="outline" size="sm">
                  Join
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}