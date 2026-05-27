/**
 * Shared OAuth start helpers used by SignInModal and TutorialModal.
 *
 * The flow has two branches:
 *  - Existing anonymous user: try linkIdentity to upgrade the session in
 *    place so attempts/leagues stay attached. If the provider identity is
 *    already on another account, fall back to a fresh sign-in (and lose the
 *    anonymous data).
 *  - No user / non-anonymous: plain signInWithOAuth.
 *
 * Both paths are best-effort and report start failures to Sentry. Success
 * means "OAuth redirect URL issued" — the actual sign-in completes on the
 * /auth/callback redirect, not in this code.
 */

import * as Sentry from '@sentry/nextjs';
import { supabase } from '@/lib/supabase/client';
import { trackAuthUpgradeStarted, trackSignIn } from '@/lib/analytics';

export type OAuthProvider = 'google' | 'apple';

function captureOAuthStartFailure(
  provider: OAuthProvider,
  redirectTo: string,
  reason: string,
  error: unknown,
) {
  Sentry.withScope((scope) => {
    scope.setTag('auth.provider', provider);
    scope.setTag('auth.flow', 'oauth_start');
    scope.setContext('auth', { provider, redirectTo, reason });
    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(String(reason), { level: 'error', extra: { error } });
    }
  });
}

async function signInWithOAuthOrReport(
  provider: OAuthProvider,
  redirectTo: string,
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

async function linkIdentityToAnonymous(
  provider: OAuthProvider,
  redirectTo: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: 'identity_taken' | 'unknown'; error: unknown }
> {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo },
  });

  if (error) {
    const message = error.message?.toLowerCase() ?? '';
    const identityTaken =
      message.includes('already') ||
      message.includes('exists') ||
      message.includes('registered');
    return {
      ok: false,
      reason: identityTaken ? 'identity_taken' : 'unknown',
      error,
    };
  }

  if (data?.url) {
    Sentry.addBreadcrumb({
      category: 'auth',
      type: 'default',
      level: 'info',
      message: 'OAuth link redirect URL issued',
      data: { provider, hasUrl: true },
    });
  }
  return { ok: true };
}

/**
 * Build the /auth/callback URL with an optional `next` param so the callback
 * can return the user to where they started after the OAuth round-trip.
 *
 * Only forwards internal paths (avoids open redirects) and skips the home
 * page and the callback itself (no point).
 *
 * Extra query params (e.g. tutorial_resume=1) are appended verbatim — useful
 * for letting the post-redirect home page know to resume a flow.
 */
export function buildOAuthRedirect(extraParams?: Record<string, string>): string {
  const callbackUrl = new URL('/auth/callback', window.location.origin);
  const currentPath = window.location.pathname + window.location.search;
  if (
    currentPath.startsWith('/') &&
    !currentPath.startsWith('//') &&
    !currentPath.startsWith('/auth/') &&
    currentPath !== '/'
  ) {
    callbackUrl.searchParams.set('next', currentPath);
  }
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      callbackUrl.searchParams.set(k, v);
    }
  }
  return callbackUrl.toString();
}

/**
 * Kick off OAuth from whatever state the user is currently in.
 *
 * Returns nothing — on success the browser is about to redirect. Callers can
 * disable buttons while awaiting the promise but should not assume failure
 * just because it resolves (the redirect itself doesn't resolve a JS promise).
 */
export async function startOAuth(
  provider: OAuthProvider,
  redirectTo: string,
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    if (user?.is_anonymous) {
      trackAuthUpgradeStarted({ provider });
      const linkUrl = new URL(redirectTo);
      linkUrl.searchParams.set('link_provider', provider);
      const linkRedirect = linkUrl.toString();
      const result = await linkIdentityToAnonymous(provider, linkRedirect);

      if (result.ok) return;

      if (result.reason === 'identity_taken') {
        Sentry.addBreadcrumb({
          category: 'auth',
          message: 'linkIdentity rejected (identity already exists); falling back to fresh OAuth',
          data: { provider },
        });
        await supabase.auth.signOut();
        trackSignIn({ provider, is_upgrade: false });
        await signInWithOAuthOrReport(provider, redirectTo);
        return;
      }

      captureOAuthStartFailure(provider, redirectTo, 'linkIdentity failed', result.error);
      return;
    }

    trackSignIn({ provider, is_upgrade: false });
    await signInWithOAuthOrReport(provider, redirectTo);
  } catch (error) {
    captureOAuthStartFailure(provider, redirectTo, 'unexpected throw', error);
  }
}
