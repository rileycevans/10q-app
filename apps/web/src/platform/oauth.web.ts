import type { OAuth, OAuthProvider } from './types';
import { startOAuth, buildOAuthRedirect } from '@/lib/auth/oauth';

/**
 * Web OAuth — a full-page redirect.
 *
 * Thin on purpose. lib/auth/oauth.ts already owns the branch that matters:
 * an anonymous user is upgraded with linkIdentity so the user id survives and
 * their streak, scores and leagues stay attached; anyone else gets a plain
 * signInWithOAuth. That logic is platform-independent and stays where it is.
 *
 * `signIn` and `link` are the same call here, because on web the decision is
 * made from the current user rather than by the caller. The interface keeps
 * them separate for native, where cold sign-in uses a native credential sheet
 * (signInWithIdToken) and linking must stay on the redirect flow.
 *
 * Neither resolves meaningfully: the page navigates away mid-promise.
 */
const oauth: OAuth = {
  async signIn(provider: OAuthProvider) {
    await startOAuth(provider, buildOAuthRedirect());
  },

  async link(provider: OAuthProvider) {
    await startOAuth(provider, buildOAuthRedirect());
  },
};

export default oauth;
