import PostPrayer from '@/pages/PostPrayer';
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import AuthCallback from '@/pages/AuthCallback'
import PublicProfile from '@/pages/PublicProfile';

// Pages
import Feed from '@/pages/Feed';
import Login from '@/pages/Login';
import Pricing from '@/pages/Pricing';
import Settings from '@/pages/Settings';
import Groups from '@/pages/Groups';
import Circles from '@/pages/Circles';
import Privacy from '@/pages/Privacy';
import Terms from '@/pages/Terms';

// Layout
import Layout from '@/components/Layout';

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="cyberkingdom-theme">
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/feed" replace />} />
            <Route path="feed" element={<Feed />} />
            <Route path="pricing" element={<Pricing />} />
            <Route path="settings" element={<Settings />} />
            <Route path="profile" element={<Settings />} />
            <Route path="groups" element={<Groups />} />
            <Route path="circles" element={<Circles />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="terms" element={<Terms />} />
            <Route path="/post" element={<PostPrayer />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/u/:username" element={<PublicProfile />} />
          </Route>
        </Routes>
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;