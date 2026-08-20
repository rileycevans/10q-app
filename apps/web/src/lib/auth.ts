import { supabase } from './supabase/client';
import { storage } from '@/platform';

/**
 * Get current session
 */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Sign out
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** The key Supabase uses for the persisted session, derived from the project ref. */
function authStorageKey(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  const ref = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  return ref ? `sb-${ref}-auth-token` : null;
}

/**
 * One-time migration: adopt a session left in a cookie by the previous client.
 *
 * Sessions used to live in cookies, via `@supabase/ssr`'s createBrowserClient.
 * They now live in localStorage so web and native share one client
 * construction. Everyone already signed in has their session in the old
 * place, and the new client cannot see it.
 *
 * Without this, that reads as "no session" — and `ensureSession()` responds by
 * minting a brand-new anonymous user, silently orphaning the streak, scores,
 * history and league membership attached to the real one. Verified in the
 * browser: the user id changed on first load after the switch.
 *
 * So: before concluding anyone is new, look where their session used to be.
 * Best-effort — a malformed cookie just means we fall through to the normal
 * path rather than throwing on someone's first visit.
 */
async function adoptLegacyCookieSession(): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const key = authStorageKey();
  if (!key) return false;

  const cookie = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${key}=`));
  if (!cookie) return false;

  try {
    let raw = decodeURIComponent(cookie.slice(key.length + 1));

    // @supabase/ssr wrote large sessions base64-encoded with this prefix.
    if (raw.startsWith('base64-')) {
      raw = atob(raw.slice('base64-'.length));
    }

    const parsed = JSON.parse(raw);
    const access_token = parsed?.access_token;
    const refresh_token = parsed?.refresh_token;
    if (!access_token || !refresh_token) return false;

    // setSession validates against Supabase and persists through the new
    // storage adapter, so the identity carries over intact.
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error || !data.session) return false;

    // Clear the cookie so this runs once and the stale copy stops shadowing.
    document.cookie = `${key}=; Max-Age=0; path=/`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a session exists — creating an anonymous one only when it is safe to.
 *
 * The order matters, and every step exists because of a specific failure:
 *
 *   1. An existing session is used as-is.
 *   2. A session in the legacy cookie is adopted, so the switch to
 *      localStorage does not orphan everyone who was already signed in.
 *   3. A new anonymous user is minted ONLY once storage has proven durable.
 *
 * Step 3 is the one that matters most. `signInAnonymously()` is irreversible
 * from the player's side: the old account still exists, but nothing in the app
 * can find it again. A storage read that fails and a genuinely empty store are
 * indistinguishable through `getItem`, so this gates on a positive
 * round-tripped probe — `isDurable()` — rather than on an absent value.
 *
 * The previous guard here checked for any key matching `sb-*-auth-token` and
 * threw 'OAuth flow in progress'. That was meant to avoid clobbering an
 * in-flight PKCE exchange, but it keys off the session key itself — so once
 * the session moved into localStorage it would match on every call and throw
 * for everyone. It is replaced with a check for the actual PKCE verifier.
 */
export async function ensureSession() {
  const existing = await getSession();
  if (existing) return existing;

  if (await adoptLegacyCookieSession()) {
    const adopted = await getSession();
    if (adopted) return adopted;
  }

  // A PKCE exchange in flight owns the session that is about to exist.
  // Creating an anonymous user now would win the race and discard it.
  if (typeof window !== 'undefined') {
    try {
      const hasVerifier = Object.keys(window.localStorage).some(
        (key) => key.includes('code-verifier') || key.includes('pkce'),
      );
      if (hasVerifier) throw new Error('OAuth flow in progress');
    } catch (error) {
      if (error instanceof Error && error.message === 'OAuth flow in progress') throw error;
      // localStorage unreadable — fall through to the durability check, which
      // is the thing that actually protects the account.
    }
  }

  // The gate. Anything other than a proven-durable store means we do not know
  // whether this person is new, and the safe answer to "should I create an
  // account?" under uncertainty is no.
  if (!(await storage.isDurable())) {
    throw new Error(
      'Storage is not durable — refusing to create an anonymous session. ' +
        'Creating one here would orphan an existing account that simply could not be read.',
    );
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.session!;
}
