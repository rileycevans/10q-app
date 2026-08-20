/**
 * OAuth callback URL parsing and the decision it drives.
 *
 * Extracted from the React page for two reasons. It is the only part of the
 * flow with real branching — code exchange, provider error, identity-already-
 * linked recovery, implicit-flow access token — and native needs the same
 * decisions from a deep link rather than from `window.location`, where there
 * is no page to read.
 *
 * Pure: takes a URL, returns what to do. No Supabase calls, no navigation.
 */

export type CallbackAction =
  | { type: 'exchange_code'; code: string; next: string }
  | { type: 'implicit_session'; next: string }
  | { type: 'recover_sign_in'; provider: 'google' | 'apple'; next: string }
  | { type: 'error'; message: string; code: string | null; next: string }
  | { type: 'nothing'; next: string };

/**
 * Only same-origin internal paths are honoured, so a crafted `next` cannot
 * bounce someone off-site with a fresh session in hand.
 *
 * `//evil.com` is the case worth naming: it is a protocol-relative URL that
 * starts with '/' and would pass a naive check.
 */
export function safeNextPath(next: string | null): string {
  if (!next) return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  if (next.startsWith('/auth/')) return '/'; // no callback loops
  return next;
}

/** Whether a provider error means "this identity belongs to another account". */
function isIdentityAlreadyLinked(description: string | null): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return d.includes('already');
}

export function parseCallback(url: string): CallbackAction {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { type: 'nothing', next: '/' };
  }

  const query = parsed.searchParams;
  // Implicit flow returns tokens in the fragment.
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));

  const next = safeNextPath(query.get('next'));
  const errorCode = query.get('error');
  const errorDescription = query.get('error_description');
  const linkProvider = query.get('link_provider');

  if (errorCode || errorDescription) {
    // Recovery: the player tapped Sign In on an anonymous session and the
    // provider identity already belongs to another account. linkIdentity
    // cannot merge them, so sign the anonymous session out and sign in to the
    // existing account. Anonymous progress is discarded — deliberately, and
    // it is the lesser loss compared with stranding them on an account they
    // cannot reach.
    if (
      isIdentityAlreadyLinked(errorDescription) &&
      (linkProvider === 'google' || linkProvider === 'apple')
    ) {
      return { type: 'recover_sign_in', provider: linkProvider, next };
    }

    return {
      type: 'error',
      message: errorDescription || 'Authentication failed',
      code: errorCode,
      next,
    };
  }

  const code = query.get('code');
  if (code) return { type: 'exchange_code', code, next };

  if (hash.get('access_token')) return { type: 'implicit_session', next };

  return { type: 'nothing', next };
}

/**
 * The URL to send someone back to after a recovery sign-in.
 *
 * `next` is carried through. The previous inline version rebuilt this as
 * `${origin}/auth/callback` with no parameters, so anyone who hit the
 * recovery path lost their destination and landed on the home page — after
 * being told they were being signed in to the thing they had asked for.
 */
export function buildRecoveryRedirect(origin: string, next: string): string {
  const url = new URL('/auth/callback', origin);
  if (next && next !== '/') url.searchParams.set('next', next);
  return url.toString();
}
