'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import * as Sentry from '@sentry/nextjs';
import { ArcadeBackground } from '@/components/ArcadeBackground';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the code from the URL
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const queryParams = new URLSearchParams(window.location.search);

        const code = queryParams.get('code');
        const errorCode = queryParams.get('error');
        const errorDescription = queryParams.get('error_description');

        if (errorCode || errorDescription) {
          Sentry.withScope((scope) => {
            scope.setTag('auth.flow', 'oauth_callback');
            scope.setLevel('error');
            scope.setContext('auth_callback', {
              errorCode,
              errorDescription,
            });
            Sentry.captureMessage('OAuth callback returned error params');
          });
          setError(errorDescription || 'Authentication failed');
          setTimeout(() => router.push('/'), 2000);
          return;
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

          if (exchangeError) {
            console.error('Error exchanging code for session:', exchangeError);
            Sentry.withScope((scope) => {
              scope.setTag('auth.flow', 'oauth_callback');
              scope.setLevel('error');
              Sentry.captureException(exchangeError);
            });
            setError('Failed to complete sign in');
            setTimeout(() => router.push('/'), 2000);
            return;
          }
        }

        // Check for access_token in hash (some OAuth flows use this)
        const accessToken = hashParams.get('access_token');
        if (accessToken) {
          // Session should already be set by Supabase client
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            setError('Failed to establish session');
            setTimeout(() => router.push('/'), 2000);
            return;
          }
        }

        // Success - redirect to home
        router.push('/');
      } catch (err) {
        console.error('Callback error:', err);
        Sentry.captureException(err);
        setError('An unexpected error occurred');
        setTimeout(() => router.push('/'), 2000);
      }
    };

    handleCallback();
  }, [router]);

  return (
    <ArcadeBackground>
      <div className="flex items-center justify-center min-h-screen">
        <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 text-center">
          {error ? (
            <>
              <p className="font-bold text-lg text-ink mb-4">{error}</p>
              <p className="text-sm text-ink/60">Redirecting to home...</p>
            </>
          ) : (
            <>
              <p className="font-bold text-lg text-ink mb-4">Completing sign in...</p>
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-ink border-t-transparent"></div>
            </>
          )}
        </div>
      </div>
    </ArcadeBackground>
  );
}
