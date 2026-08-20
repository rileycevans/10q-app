import { Preferences } from '@capacitor/preferences';
import type { Storage } from './types';

/**
 * Native storage — @capacitor/preferences (NSUserDefaults / SharedPreferences).
 *
 * Not localStorage. localStorage lives in the WebView's cache, and iOS evicts
 * that under storage pressure without warning. Losing the Supabase session
 * that way would read as "no session" on the next cold start and mint a fresh
 * anonymous user, orphaning the player's streak, scores and leagues — the
 * exact failure StorageResult exists to prevent. Preferences is backed by the
 * OS key-value store and survives cache eviction, backgrounding and updates.
 *
 * Every call is wrapped so a failure is reported as `ok: false` rather than
 * collapsing into a null that the caller cannot distinguish from "empty".
 */

const PROBE_KEY = '__10q_durability_probe__';

const storage: Storage = {
  async get(key) {
    try {
      const { value } = await Preferences.get({ key });
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  },

  async set(key, value) {
    try {
      await Preferences.set({ key, value });
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  },

  async remove(key) {
    try {
      await Preferences.remove({ key });
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  },

  /**
   * Round-trip a probe rather than trusting that the plugin exists.
   *
   * This gates anonymous-user creation, so the question it answers is not
   * "is Preferences available?" but "did a value I just wrote come back?".
   * A plugin that resolves without persisting would pass any weaker check.
   */
  async isDurable() {
    try {
      const token = String(Date.now());
      await Preferences.set({ key: PROBE_KEY, value: token });
      const { value } = await Preferences.get({ key: PROBE_KEY });
      await Preferences.remove({ key: PROBE_KEY });
      return value === token;
    } catch {
      return false;
    }
  },
};

export default storage;
