import React from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import TierPill from '@/components/TierPill';

export default function PricingPage() {
  const plans = [
    {
      name: 'Believer',
      price: 'Free',
      description: 'Start your faith journey',
      features: ['Basic prayer sharing', 'Community access', 'Mobile app'],
      tier: 'basic' as const,
    },
    {
      name: 'Disciple',
      price: '$9.99/month',
      description: 'Deepen your spiritual practice',
      features: ['Everything in Believer', 'Prayer groups', 'Advanced analytics', 'Priority support'],
      tier: 'premium' as const,
      popular: true,
    },
    {
      name: 'Shepherd',
      price: '$29.99/month',
      description: 'Lead and inspire others',
      features: ['Everything in Disciple', 'Create groups', 'Outreach tools', 'Ministry dashboard'],
      tier: 'leader' as const,
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-16">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-america-text mb-4">
          Choose Your Faith Journey
        </h1>
        <p className="text-xl text-america-gray-dark max-w-2xl mx-auto">
          Join thousands of believers in strengthening faith through community and prayer
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        {plans.map((plan) => (
          <Card key={plan.name} className={`relative ${plan.popular ? 'ring-2 ring-america-red' : ''}`}>
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                <TierPill tier="premium" />
              </div>
            )}
            <CardHeader>
              <CardTitle className="text-xl text-america-navy">{plan.name}</CardTitle>
              <CardDescription>{plan.description}</CardDescription>
              <div className="text-3xl font-bold text-america-text">{plan.price}</div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 mb-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center">
                    <Check className="h-5 w-5 text-america-red mr-2" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
              <Button className={`w-full ${plan.popular ? 'america-button' : ''}`} variant={plan.popular ? 'default' : 'outline'}>
                {plan.price === 'Free' ? 'Get Started' : 'Subscribe'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}