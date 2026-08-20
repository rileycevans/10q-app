import type { Storage } from "./types";

/**
 * Web storage — localStorage, with failures reported rather than swallowed.
 *
 * localStorage throws in Safari private mode and when a quota is exceeded,
 * and `getItem` returns null for both "empty" and "unavailable". Callers need
 * to tell those apart, so every operation is wrapped and the difference is
 * carried in the return type. See StorageResult in types.ts.
 */

const PROBE_KEY = "__10q_durability_probe__";

/**
 * The subset of the Storage API this uses. Named so the implementation can be
 * built over an injected store in tests — the durability logic is the part
 * worth testing, and it should not need a DOM to exercise.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Resolved per call: tests inject, production reads window.localStorage. */
function defaultStore(): KeyValueStore {
  return window.localStorage;
}

export function createWebStorage(
  getStore: () => KeyValueStore = defaultStore,
): Storage {
  return {
    async get(key) {
      try {
        return { ok: true, value: getStore().getItem(key) };
      } catch (error) {
        return { ok: false, error: error as Error };
      }
    },

    async set(key, value) {
      try {
        getStore().setItem(key, value);
        return { ok: true, value: undefined };
      } catch (error) {
        return { ok: false, error: error as Error };
      }
    },

    async remove(key) {
      try {
        getStore().removeItem(key);
        return { ok: true, value: undefined };
      } catch (error) {
        return { ok: false, error: error as Error };
      }
    },

    /**
     * Round-trip a probe rather than feature-detecting.
     *
     * `typeof localStorage !== 'undefined'` is true in Safari private mode right
     * up until the write throws, so presence proves nothing. Writing and reading
     * back is the only honest check.
     */
    async isDurable() {
      try {
        const store = getStore();
        const token = String(Date.now());
        store.setItem(PROBE_KEY, token);
        const read = store.getItem(PROBE_KEY);
        store.removeItem(PROBE_KEY);
        return read === token;
      } catch {
        return false;
      }
    },
  };
}

const storage: Storage = createWebStorage();

export default storage;
