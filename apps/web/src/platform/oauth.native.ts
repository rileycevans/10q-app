import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import type { OAuth, OAuthProvider } from './types';
import { supabase } from './session.native';
import { parseCallback } from '@/lib/auth/callback';
import { trackAppError } from '@/lib/analytics';
import { trackAuthUpgradeStarted, trackSignIn } from '@/lib/analytics';

/**
 * Native OAuth.
 *
 * The mechanism is the same as web — Supabase's redirect flow, and
 * linkIdentity for an anonymous player — but the RETURN PATH is different,
 * and that is the whole problem.
 *
 * On web the provider redirects the page and the app resumes at
 * /auth/callback. Inside a WebView there is no page to redirect: the browser
 * opens, the player signs in, and the callback has nowhere to land. That is
 * why sign-in bounced to Safari and never came back.
 *
 * So:
 *   - `skipBrowserRedirect: true` gets the URL instead of navigating to it
 *   - `@capacitor/browser` opens it in ASWebAuthenticationSession / Custom
 *     Tabs, which Google requires (an embedded WebView gets
 *     `disallowed_useragent`) and which shares Safari's cookie jar, so an
 *     already-signed-in Apple or Google session needs no re-entry
 *   - an `appUrlOpen` listener catches the custom-scheme callback and
 *     completes the exchange
 *
 * Deliberately NOT signInWithIdToken, despite the plan suggesting it. That
 * signs in AS the provider identity, which cannot upgrade an existing
 * anonymous user — it would switch to a different account and orphan their
 * streak, scores and leagues. With 1,012 anonymous users against 17 signed
 * in, that is the overwhelmingly common path and it must keep working.
 */

/**
 * Where the provider sends the player back.
 *
 * A CUSTOM SCHEME, not a Universal Link — and the reason is a rule that is
 * easy to get backwards.
 *
 * iOS only routes an https URL into the app when the navigation is USER
 * INITIATED: someone taps a link. A URL that arrives as a 302 inside
 * ASWebAuthenticationSession is not user initiated, so iOS lets the sheet
 * follow it like any other redirect. The Associated Domains entitlement and
 * a correctly served AASA make no difference — the link was never eligible.
 *
 * This was tried and it failed exactly that way: the sheet followed the
 * redirect to play10q.com/auth/callback, the WEB callback page ran inside the
 * sheet, exchanged the code against its own storage and routed to the home
 * screen. The player was signed in — in the browser, not in the app — and
 * dismissing the sheet threw that session away.
 *
 * ASWebAuthenticationSession intercepts custom schemes by design, whatever
 * started the navigation, which is why Apple recommends one here.
 *
 * Apple's response_mode=form_post is not an obstacle: the POST goes to
 * Supabase's /auth/v1/callback, and only then does Supabase redirect to
 * redirect_to. That last hop is an ordinary redirect and carries the code
 * to the scheme without trouble.
 *
 * The Universal Link stays registered in the AASA — it is what makes shared
 * /invite, /u and /results links open in the app, which is a real feature.
 * It is only wrong as an OAuth return path.
 */
const CALLBACK_SCHEME = 'com.play10q.app';

/**
 * Bare — no query string, ever. The Supabase allow-list holds the custom
 * scheme as an EXACT entry, and probing /auth/v1/verify shows what that
 * means in practice:
 *
 *   com.play10q.app://auth/callback                      -> accepted
 *   com.play10q.app://auth/callback?link_provider=apple  -> Site URL fallback
 *
 * The fallback sends the whole exchange to https://play10q.com in the
 * browser sheet, where the web app helpfully resumes whatever session its
 * storage holds — while the native app waits on a callback that is never
 * coming. Web gets away with the query param because its allow-list entry
 * is a wildcard; the scheme entry is not.
 *
 * Native never needed the param anyway: link_provider exists so the WEB
 * callback page can recover an already-linked identity knowing nothing but
 * its URL. Native still holds `provider` in scope and recovers directly.
 */
const REDIRECT_URL = `${CALLBACK_SCHEME}://auth/callback`;

/** Either form counts as our callback. */
function isOurCallback(url: string): boolean {
  return (
    url.startsWith(CALLBACK_SCHEME) ||
    url.startsWith('https://play10q.com/auth/callback') ||
    url.startsWith('https://www.play10q.com/auth/callback')
  );
}

/** A player who abandons the sheet should not leave a listener behind. */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run one OAuth exchange and wait for the callback.
 *
 * Resolves when the session is established, or rejects with something worth
 * showing. The listener is always removed.
 */
async function completeInBrowser(authUrl: string): Promise<void> {
  // Typed through a holder: assigning inside the promise callback below
  // makes TypeScript narrow a bare `let` to `never` at the finally block.
  const cleanup: { remove: (() => void) | null } = { remove: null };
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      timer = setTimeout(
        () => finish(new Error('Sign-in timed out')),
        AUTH_TIMEOUT_MS,
      );

      // Capacitor surfaces both custom-scheme opens and Universal Links
      // through appUrlOpen, so one listener covers Google and Apple.

      // Attach BEFORE opening the browser. addListener is async, and the
      // callback can arrive fast enough to be missed otherwise — the same
      // race that lost push tokens.
      void App.addListener('appUrlOpen', async ({ url }) => {
        if (!isOurCallback(url)) return;

        try {
          // Close the sheet first so the player sees the app, not a spinner
          // behind a browser they have to dismiss.
          await Browser.close().catch(() => {});

          // The same parser the web callback uses, so the two paths cannot
          // disagree about what a callback means.
          const action = parseCallback(url);

          if (action.type === 'exchange_code') {
            const { error } = await supabase.auth.exchangeCodeForSession(action.code);
            if (error) {
              // The code may already have been consumed; a session is what
              // actually matters — a non-anonymous one, or this reports the
              // leftover anonymous session as the sign-in that just failed.
              const { data } = await supabase.auth.getSession();
              if (!data.session || data.session.user.is_anonymous) {
                return finish(new Error(error.message));
              }
            }
            return finish();
          }

          if (action.type === 'error') {
            return finish(new Error(action.message));
          }

          if (action.type === 'recover_sign_in') {
            // parseCallback only returns this when link_provider survives in
            // the URL, which native no longer sends — but if it ever arrives,
            // falling through would hit the session check below and report
            // the still-anonymous session as a successful sign-in. Surface it
            // as the already-linked error so signIn() runs its recovery.
            return finish(new Error('Identity is already linked to another user'));
          }

          if (action.type === 'implicit_session') {
            // detectSessionInUrl is false on native, so nothing consumes the
            // fragment automatically. Without this the tokens are simply
            // dropped and the player is told sign-in failed while holding a
            // perfectly good session in the URL.
            const hash = new URLSearchParams(
              (url.split('#')[1] ?? '').replace(/^#/, ''),
            );
            const access_token = hash.get('access_token');
            const refresh_token = hash.get('refresh_token');

            if (access_token && refresh_token) {
              const { error } = await supabase.auth.setSession({
                access_token,
                refresh_token,
              });
              if (error) return finish(new Error(error.message));
              return finish();
            }
          }

          // Nothing recognisable in the URL. A session may still exist if the
          // exchange happened elsewhere, so check before calling it a
          // failure — but it must be a NON-ANONYMOUS session. Every desired
          // end state of OAuth is a user with a real identity, and on native
          // the anonymous session is still sitting in storage, so a bare
          // "is there a session" check turns every failure into a success.
          const { data } = await supabase.auth.getSession();
          const signedIn = data.session && !data.session.user.is_anonymous;
          finish(signedIn ? undefined : new Error('Sign-in did not complete'));
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      }).then((handle) => {
        cleanup.remove = () => void handle.remove();
        if (settled) cleanup.remove();
      });

      void Browser.open({ url: authUrl, presentationStyle: 'popover' });
    });
  } finally {
    if (timer) clearTimeout(timer);
    cleanup.remove?.();
  }
}

/** Ask Supabase for the URL without navigating to it. */
async function authUrlFor(provider: OAuthProvider): Promise<string> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    throw new Error(error?.message ?? 'Could not start sign-in');
  }
  return data.url;
}

/**
 * Does this anonymous account hold anything a link would preserve?
 *
 * Anonymous-first means EVERY sign-in starts from an anonymous session — and
 * for a returning player (sign-out, reinstall, new phone) that session is
 * minutes old and empty, while their identity already belongs to their real
 * account. Attempting linkIdentity there is guaranteed to fail, and the
 * recovery costs a second browser sheet: fail, sign out, sign in again. Two
 * sheets for the most common path, protecting nothing.
 *
 * So: link only when there is something to lose. Three signals, all readable
 * under RLS (attempts_read_own, league_members_read_member,
 * players_read_public):
 *
 *   attempts        — any quiz ever started; carries scores and streaks
 *   league_members  — social ties that would otherwise be orphaned
 *   handle_last_changed_at — set only when the player picked a handle
 *                     themselves, e.g. in the tutorial before first play
 *
 * Errors count as progress. A failed read must degrade to the old two-sheet
 * flow, never to silently discarding a real account.
 */
async function anonymousProgressWorthKeeping(userId: string): Promise<boolean> {
  try {
    const [attempt, league, player] = await Promise.all([
      supabase.from('attempts').select('id').eq('player_id', userId).limit(1),
      supabase.from('league_members').select('league_id').eq('player_id', userId).limit(1),
      supabase.from('players').select('handle_last_changed_at').eq('id', userId).maybeSingle(),
    ]);

    if (attempt.error || league.error || player.error) return true;

    return Boolean(
      attempt.data?.length ||
      league.data?.length ||
      player.data?.handle_last_changed_at,
    );
  } catch {
    return true;
  }
}

const oauth: OAuth = {
  async signIn(provider: OAuthProvider) {
    // Mirrors lib/auth/oauth.ts: an anonymous player is upgraded in place so
    // their history survives; anyone else signs in normally.
    const { data: { user } } = await supabase.auth.getUser();

    if (user?.is_anonymous && (await anonymousProgressWorthKeeping(user.id))) {
      trackAuthUpgradeStarted({ provider });

      const { data, error } = await supabase.auth.linkIdentity({
        provider,
        options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
      });

      if (!error && data?.url) {
        try {
          await completeInBrowser(data.url);
          return;
        } catch (err) {
          // The identity already belongs to another account. Fall through to
          // a plain sign-in, which is what the web path does — the anonymous
          // progress is lost, but the alternative is a player who can never
          // reach their real account.
          const message = err instanceof Error ? err.message.toLowerCase() : '';
          if (!message.includes('already')) throw err;

          await supabase.auth.signOut();
        }
      } else if (error) {
        trackAppError({
          location: 'native_link_identity',
          message: error.message,
        });
      }
    }

    trackSignIn({ provider, is_upgrade: false });
    await completeInBrowser(await authUrlFor(provider));
  },

  async link(provider: OAuthProvider) {
    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
    });

    if (error || !data?.url) {
      throw new Error(error?.message ?? 'Could not start account linking');
    }

    await completeInBrowser(data.url);
  },
};

export default oauth;
