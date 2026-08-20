import type { Storage } from './types';

/**
 * Native storage — @capacitor/preferences (NSUserDefaults / SharedPreferences).
 *
 * NOT YET IMPLEMENTED. `@capacitor/*` dependencies cannot be added until the
 * 0E gate clears (see docs/cross-platform/05-migration-plan.md); adding one
 * early is what the gate exists to prevent.
 *
 * Preferences rather than localStorage because localStorage lives in the
 * WebView's cache, and iOS evicts that under storage pressure. A player who
 * lost their session that way would come back as a new anonymous user with no
 * streak — the exact failure StorageResult exists to make impossible.
 *
 * When implementing:
 *   import { Preferences } from '@capacitor/preferences';
 *   get:  const { value } = await Preferences.get({ key })  -> { ok: true, value }
 *   wrap every call, and map a thrown error to { ok: false, error }.
 */

const NOT_IMPLEMENTED = new Error(
  'storage.native is not implemented — @capacitor/preferences is gated on 0E',
);

const storage: Storage = {
  async get() {
    return { ok: false, error: NOT_IMPLEMENTED };
  },
  async set() {
    return { ok: false, error: NOT_IMPLEMENTED };
  },
  async remove() {
    return { ok: false, error: NOT_IMPLEMENTED };
  },
  /**
   * False, not a throw. isDurable() gates anonymous-user creation, and the
   * safe answer for "is storage durable?" when storage does not work yet is
   * no — which blocks minting an account rather than orphaning one.
   */
  async isDurable() {
    return false;
  },
};

export default storage;
