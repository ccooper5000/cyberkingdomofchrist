import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-america-text mb-2">Terms of Service</h1>
        <p className="text-america-gray-dark">Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Terms of Service Content</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-america-gray-dark">
            Terms of service content will be added here. This should include:
            - User responsibilities and conduct
            - Platform usage guidelines
            - Faith-based community standards
            - Subscription terms (for Stripe integration)
            - Intellectual property rights
            - Dispute resolution procedures
          </p>
        </CardContent>
      </Card>
    </div>
  );
}