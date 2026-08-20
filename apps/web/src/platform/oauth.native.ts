import type { OAuth } from './types';

/**
 * Native OAuth — gated on 0E.
 *
 * Cannot delegate to the web implementation the way share and lifecycle do:
 * a full-page redirect inside a WebView is exactly what breaks. Google returns
 * `disallowed_useragent` for embedded WebViews, and even where a provider
 * allows it, the redirect back has nowhere to land.
 *
 * The shape it needs:
 *   signIn  cold sign-in via signInWithIdToken, using the native credential
 *           sheet (Sign in with Apple / Google One Tap). No browser at all.
 *   link    stays on the redirect flow — linkIdentity has no idToken
 *           equivalent — with skipBrowserRedirect: true, the URL opened in
 *           @capacitor/browser (ASWebAuthenticationSession / Custom Tabs),
 *           and an appUrlOpen listener completing the exchange against the
 *           registered custom scheme.
 *
 * Throws rather than no-ops: a silent failure here looks to the player like a
 * sign-in button that does nothing, which is worse than an error.
 */
const oauth: OAuth = {
  async signIn() {
    throw new Error('oauth.native.signIn is not implemented — gated on 0E');
  },
  async link() {
    throw new Error('oauth.native.link is not implemented — gated on 0E');
  },
};

export default oauth;
