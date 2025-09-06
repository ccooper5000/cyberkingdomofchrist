import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-america-text mb-2">Privacy Policy</h1>
        <p className="text-america-gray-dark">Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Privacy Policy Content</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-america-gray-dark">
            Privacy policy content will be added here. This should include:
            - Data collection practices
            - How user information is used
            - Third-party integrations (Supabase, Stripe)
            - User rights and data protection
            - Contact information for privacy concerns
          </p>
        </CardContent>
      </Card>
    </div>
  );
}