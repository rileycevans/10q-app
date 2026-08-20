import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
 * The storage adapter below is still localStorage-backed because
 * @capacitor/preferences is gated on 0E. That is safe for a shell build and
 * WRONG for a shipped app — swap it before any store binary exists.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * TODO(0E): replace with @capacitor/preferences.
 *
 *   import { Preferences } from '@capacitor/preferences';
 *   getItem: (await Preferences.get({ key })).value
 *   setItem: await Preferences.set({ key, value })
 *   removeItem: await Preferences.remove({ key })
 */
const nativeSessionStorage: SessionStorageAdapter = {
  async getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* session stays in memory */
    }
  },
  async removeItem(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* already cleared in memory */
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
