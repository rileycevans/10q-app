'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import * as Sentry from '@sentry/nextjs';
import { parseCallback, buildRecoveryRedirect } from '@/lib/auth/callback';
import { ArcadeBackground } from '@/components/ArcadeBackground';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [recoveringSignIn, setRecoveringSignIn] = useState(false);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the code from the URL
        // URL parsing and the branch it drives live in lib/auth/callback.ts:
        // it is the only part of this flow with real decisions in it, and
        // native has to make the same ones from a deep link where there is no
        // window.location to read.
        const action = parseCallback(window.location.href);
        const safeNext = action.next;
        const errorCode = action.type === 'error' ? action.code : null;
        const errorDescription = action.type === 'error' ? action.message : null;

        if (action.type === 'recover_sign_in') {
          setRecoveringSignIn(true);
          setError('Identity already linked to another user. Signing you in to your existing account...');
          // Give React a moment to paint the message before the OAuth
          // redirect replaces the page.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await supabase.auth.signOut();
          await supabase.auth.signInWithOAuth({
            provider: action.provider,
            options: {
              // Carries next. This used to be a bare
              // `${origin}/auth/callback`, so anyone recovering an account
              // was told they were being signed in to what they asked for and
              // then landed on the home page instead.
              redirectTo: buildRecoveryRedirect(window.location.origin, safeNext),
            },
          });
          return;
        }

        if (action.type === 'error') {
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

        if (action.type === 'exchange_code') {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(action.code);

          if (exchangeError) {
            // The Supabase server-side /callback may have already exchanged
            // the code and set the session cookie. In that case the client
            // exchange fails ("code already used") but the user IS signed
            // in. Check for a session before reporting failure.
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
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
        }

        // Implicit flow returns tokens in the fragment instead of a code.
        if (action.type === 'implicit_session') {
          // Session should already be set by Supabase client
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            setError('Failed to establish session');
            setTimeout(() => router.push('/'), 2000);
            return;
          }
        }

        // Success - redirect to the page the user came from, or home.
        router.push(safeNext);
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
              <p className="text-sm text-ink/60">
                {recoveringSignIn ? 'Redirecting to sign in...' : 'Redirecting to home...'}
              </p>
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
