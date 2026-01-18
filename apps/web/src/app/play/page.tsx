'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentQuiz } from '@/domains/quiz';
import { startAttempt } from '@/domains/attempt';
import { getSession } from '@/lib/auth';
import { ArcadeBackground } from '@/components/ArcadeBackground';
import { supabase } from '@/lib/supabase/client';
import dynamic from 'next/dynamic';

// Dynamically import AuthButton to avoid SSR issues
const AuthButton = dynamic(() => import('@/components/AuthButton').then(mod => mod.AuthButton), { ssr: false });

export default function PlayPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const errorRef = useRef<string | null>(null);

  // Keep errorRef in sync with error state
  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  useEffect(() => {
    let mounted = true;
    let authSubscription: { unsubscribe: () => void } | null = null;

    async function initialize() {
      if (!mounted) return;
      
      try {
        setLoading(true);
        setError(null);
        
        // Check authentication first
        const session = await getSession();
        if (!session) {
          setError('Please sign in to play. Click "Sign In" in the top-right corner.');
          setLoading(false);
          return;
        }

        // Get current quiz
        const currentQuiz = await getCurrentQuiz();
        
        if (!currentQuiz) {
          // QUIZ_NOT_AVAILABLE - show countdown
          updateCountdown();
          setError('No quiz available. Come back at 11:30 UTC!');
          setLoading(false);
          return;
        }

        // Start or resume attempt
        const attemptState = await startAttempt(currentQuiz.quiz_id);

        if (!mounted) return;

        // Route based on attempt state
        if (attemptState.state === 'FINALIZED') {
          router.push('/tomorrow');
        } else if (attemptState.current_index <= 10) {
          router.push(`/play/q/${attemptState.current_index}`);
        } else if (attemptState.state === 'READY_TO_FINALIZE') {
          router.push('/play/finalize');
        } else {
          setError('Unexpected attempt state');
          setLoading(false);
        }
      } catch (err) {
        if (!mounted) return;
        
        const errorMessage = err instanceof Error ? err.message : 'Failed to load quiz';
        
        // Check if it's an authentication error (401)
        if (errorMessage.includes('UNAUTHORIZED') || 
            errorMessage.includes('Authentication required') ||
            errorMessage.includes('sign in') ||
            errorMessage.includes('Sign In') ||
            errorMessage.includes('401')) {
          setError('Please sign in to play. Click "Sign In" in the top-right corner.');
        } else {
          setError(errorMessage);
        }
        
        setLoading(false);
        console.error('Play page error:', err);
      }
    }

    function updateCountdown() {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(11, 30, 0, 0);
      
      if (now.getUTCHours() > 11 || (now.getUTCHours() === 11 && now.getUTCMinutes() >= 30)) {
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      }

      const diff = tomorrow.getTime() - now.getTime();
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown(`${hours}h ${minutes}m ${seconds}s`);
    }

    // Listen for auth state changes and auto-retry when user signs in
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && errorRef.current && errorRef.current.includes('sign in')) {
        // User just signed in, retry initialization
        console.log('Auth state changed: user signed in, retrying...');
        initialize();
      }
    });
    authSubscription = subscription;

    initialize();
    
    let countdownInterval: NodeJS.Timeout | null = null;
    if (error && error.includes('11:30')) {
      countdownInterval = setInterval(updateCountdown, 1000);
    }

    return () => {
      mounted = false;
      if (authSubscription && typeof authSubscription.unsubscribe === 'function') {
        authSubscription.unsubscribe();
      }
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
    };
  }, [router]);

  if (loading) {
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8">
            <p className="font-bold text-lg text-ink">Loading...</p>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  if (error) {
    const isAuthError = error.includes('sign in') || error.includes('Sign In');
    
    return (
      <ArcadeBackground>
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="absolute top-4 right-4">
            <AuthButton />
          </div>
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
            <h1 className="font-display text-2xl mb-4 text-ink">
              {isAuthError ? 'Sign In Required' : 'Come Back Later'}
            </h1>
            <p className="font-body font-bold text-lg mb-6 text-ink">{error}</p>
            {countdown && (
              <>
                <p className="font-body text-sm mb-4 text-ink/80">
                  Next quiz releases in:
                </p>
                <p className="font-display text-2xl mb-8 text-ink">{countdown}</p>
              </>
            )}
            {isAuthError && (
              <div className="mb-6">
                <p className="font-body text-sm mb-4 text-ink/80">
                  Click the "Sign In" button in the top-right corner, then refresh this page.
                </p>
              </div>
            )}
            <div className="flex flex-col gap-3">
              {isAuthError && (
                <button
                  onClick={() => window.location.reload()}
                  className="h-14 w-full bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
                >
                  Refresh After Sign In
                </button>
              )}
              <button
                onClick={() => router.push('/')}
                className="h-14 w-full bg-paper border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)]"
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      </ArcadeBackground>
    );
  }

  return null;
}
