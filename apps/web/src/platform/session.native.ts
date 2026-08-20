import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import type { SessionStorageAdapter } from './types';

/**
 * The Supabase client for native.
 *
 * Same construction as web — `createClient` from @supabase/supabase-js — with
 * two deliberate differences:
 *
 *   storage             Preferences, not localStorage. localStorage lives in
 *                       the WebView cache, which iOS evicts under pressure;
 *                       losing the session there silently orphans the account.
 *   detectSessionInUrl  false. The deep-link handler owns the code exchange.
 *                       Leaving it true means the client races the handler for
 *                       the same one-time PKCE code and one of them loses.
 *
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * The session lives in Preferences, not localStorage.
 *
 * This is the single most important line in the native build. localStorage is
 * WebView cache; iOS evicts it under storage pressure and the player comes
 * back as a brand-new anonymous user with no streak, no history and no
 * leagues, silently. Preferences is NSUserDefaults / SharedPreferences and
 * survives that.
 */
const nativeSessionStorage: SessionStorageAdapter = {
  async getItem(key) {
    try {
      const { value } = await Preferences.get({ key });
      return value;
    } catch {
      // Reads as "no session", which prompts a sign-in rather than acting on
      // a half-read one. The dangerous reading — "new user, mint an anonymous
      // account" — is blocked by ensureSession's storage.isDurable() gate.
      return null;
    }
  },
  async setItem(key, value) {
    try {
      await Preferences.set({ key, value });
    } catch {
      // Session stays in memory: signed in until the app is killed.
    }
  },
  async removeItem(key) {
    try {
      await Preferences.remove({ key });
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
      storage: nativeSessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  },
);

export default supabase;
