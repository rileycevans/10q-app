import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SessionStorageAdapter } from './types';

/**
 * The Supabase client for web.
 *
 * Converged onto `createClient` from `@supabase/supabase-js`, dropping
 * `@supabase/ssr`'s `createBrowserClient`. The ssr package existed to share a
 * session with server-side rendering through cookies — and nothing here does
 * that: no Server Actions, no `cookies()` call, no server component that reads
 * auth. Every page is a client component talking to Edge Functions with a
 * bearer token.
 *
 * So the cookie machinery was carrying a cost with no benefit, and it made web
 * and native construct their clients two different ways. Now they differ only
 * in which storage adapter they pass, which means an auth bug reproduces on
 * whichever platform is easier to debug.
 *
 * localStorage rather than cookies for the session: it is not sent with every
 * request (a session token in a cookie header is a CSRF surface that buys
 * nothing when the server never reads it), it holds more, and it is the same
 * shape as the native Preferences adapter.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env.local file.');
}

/**
 * localStorage behind Supabase's async storage interface.
 *
 * Supabase accepts a sync or async adapter; the async shape is used on both
 * platforms so the two implementations stay swappable and the client's
 * behaviour does not depend on which one it got.
 */
const webSessionStorage: SessionStorageAdapter = {
  async getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Returning null here says "no session", which is the safe reading:
      // it prompts a sign-in rather than acting on a half-read one. The
      // dangerous conflation — treating this as "brand new user, mint an
      // anonymous account" — is prevented by gating on storage.isDurable().
      return null;
    }
  },
  async setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Nothing useful to do: the session stays in memory and the user is
      // signed in until the tab closes.
    }
  },
  async removeItem(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Sign-out already cleared the in-memory session.
    }
  },
};

export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      storage: webSessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      // Web keeps the redirect flow: the OAuth callback lands on
      // /auth/callback as a real navigation and the client reads the code
      // from the URL. Native sets this false because its deep-link handler
      // owns the exchange.
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  },
);

export default supabase;
