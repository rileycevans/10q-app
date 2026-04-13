'use client';

import { useState } from 'react';
import { upgradeToApple, upgradeToGoogle } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import * as Sentry from '@sentry/nextjs';
import { trackAuthUpgradeStarted, trackSignIn } from '@/lib/analytics';

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type OAuthProvider = 'google' | 'apple';

function captureOAuthStartFailure(
  provider: OAuthProvider,
  redirectTo: string,
  reason: string,
  error: unknown
) {
  Sentry.withScope((scope) => {
    scope.setTag('auth.provider', provider);
    scope.setTag('auth.flow', 'oauth_start');
    scope.setContext('auth', {
      provider,
      redirectTo,
      reason,
    });
    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(String(reason), { level: 'error', extra: { error } });
    }
  });
}

async function signInWithOAuthOrReport(
  provider: OAuthProvider,
  redirectTo: string
): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });

  if (error) {
    captureOAuthStartFailure(provider, redirectTo, 'signInWithOAuth returned error', error);
    return;
  }

  if (data?.url) {
    Sentry.addBreadcrumb({
      category: 'auth',
      type: 'default',
      level: 'info',
      message: 'OAuth redirect URL issued',
      data: { provider, hasUrl: true },
    });
  }
}

export function SignInModal({ isOpen, onClose }: SignInModalProps) {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);

  if (!isOpen) return null;

  const redirectTo = `${window.location.origin}/auth/callback`;

  const handleOAuth = async (provider: OAuthProvider) => {
    setLoadingProvider(provider);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.is_anonymous) {
        trackAuthUpgradeStarted({ provider });
        try {
          if (provider === 'google') await upgradeToGoogle();
          else await upgradeToApple();
        } catch (_linkErr) {
          // linkIdentity failed (identity already linked to another account) — sign out and do fresh OAuth
          Sentry.addBreadcrumb({
            category: 'auth',
            message: 'linkIdentity failed, signing out anonymous session and retrying with signInWithOAuth',
            data: { provider },
          });

          // Sign out of anonymous session first
          await supabase.auth.signOut();

          // Then do fresh OAuth sign in
          await signInWithOAuthOrReport(provider, redirectTo);
        }
      } else {
        trackSignIn({ provider, is_upgrade: false });
        await signInWithOAuthOrReport(provider, redirectTo);
      }
    } catch (error) {
      console.error('Sign in error:', error);
      captureOAuthStartFailure(provider, redirectTo, 'unexpected throw', error);
    } finally {
      setLoadingProvider(null);
    }
  };

  const isLoading = loadingProvider !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md mx-4">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-ink hover:bg-ink/10 rounded-full"
        >
          ✕
        </button>

        <h2 className="font-display text-2xl font-bold text-ink mb-2 text-center uppercase tracking-wide">
          Sign in
        </h2>
        <p className="text-center text-sm text-ink/80 font-bold mb-6">
          Pick a provider to save progress across devices.
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void handleOAuth('google')}
            disabled={isLoading}
            className="w-full h-14 bg-cyanA border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-ink flex items-center justify-center gap-3 transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] disabled:opacity-50"
          >
            {loadingProvider === 'google' ? 'Signing in...' : 'Continue with Google'}
          </button>

          <button
            type="button"
            onClick={() => void handleOAuth('apple')}
            disabled={isLoading}
            className="w-full h-14 bg-ink border-[4px] border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg text-paper flex items-center justify-center gap-3 transition-transform duration-[120ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_4px_0_var(--ink)] hover:-translate-x-[1px] hover:-translate-y-[1px] disabled:opacity-50"
          >
            {loadingProvider === 'apple' ? (
              'Signing in...'
            ) : (
              <>
                <AppleMark className="h-6 w-6 shrink-0" aria-hidden />
                Continue with Apple
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
