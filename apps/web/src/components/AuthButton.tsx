'use client';

import { useEffect, useState } from 'react';
import { getSession, signOut } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import { SignInModal } from './SignInModal';

export function AuthButton() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSignInModal, setShowSignInModal] = useState(false);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    async function init() {
      try {
        await checkAuth();
        
        // Listen for auth changes
        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((_event, session) => {
          setIsAuthenticated(!!session);
        });
        
        subscription = authSubscription;
      } catch (err) {
        console.error('Auth initialization error:', err);
        setError('Auth error');
        setIsLoading(false);
      }
    }

    init();

    return () => {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
    };
  }, []);

  async function checkAuth() {
    try {
      const session = await getSession();
      setIsAuthenticated(!!session);
    } catch (err) {
      console.error('Check auth error:', err);
      setError('Failed to check auth');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSignIn() {
    setShowSignInModal(true);
  }

  function handleAuthSuccess() {
    setIsAuthenticated(true);
    setShowSignInModal(false);
  }

  async function handleSignOut() {
    try {
      setIsLoading(true);
      await signOut();
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      setIsLoading(false);
    }
  }

  if (error) {
    return (
      <div className="h-auto px-4 py-2 bg-red border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-xs text-ink max-w-xs">
        <div className="mb-1">Auth Error</div>
        <div className="text-[10px] font-normal leading-tight">{error}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <button
        className="h-10 px-4 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink opacity-50 cursor-not-allowed"
        disabled
      >
        Loading...
      </button>
    );
  }

  if (isAuthenticated) {
    return (
      <button
        onClick={handleSignOut}
        className="h-10 px-4 bg-green border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
      >
        Sign Out
      </button>
    );
  }

  return (
    <>
      <button
        onClick={handleSignIn}
        className="h-10 px-4 bg-cyanA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
      >
        Sign In
      </button>
      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
        onSuccess={handleAuthSuccess}
      />
    </>
  );
}

