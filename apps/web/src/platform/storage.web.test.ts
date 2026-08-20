import { describe, it, expect } from 'vitest';
import { createWebStorage, type KeyValueStore } from './storage.web';

/**
 * The distinction these tests protect is the reason the seam exists.
 *
 * `localStorage.getItem` returns null both for "this key is empty" and for
 * "the read threw", and the app decides whether to mint a new anonymous user
 * from that answer. Getting it wrong orphans a real account — silently, with
 * no error the player or Sentry ever sees.
 */

/** An in-memory store that behaves. */
function workingStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Safari private mode / evicted WebView cache: every call throws. */
function throwingStore(): KeyValueStore {
  return {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
    removeItem() {
      throw new Error('SecurityError');
    },
  };
}

/** The nastiest one: writes are accepted and silently discarded. */
function amnesiacStore(): KeyValueStore {
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

describe('storage.web', () => {
  describe('read failure is distinguishable from an empty value', () => {
    it('reports an absent key as a successful read of null', async () => {
      const storage = createWebStorage(workingStore);
      expect(await storage.get('never-set')).toEqual({ ok: true, value: null });
    });

    it('reports a throwing read as ok:false, NOT as an empty value', async () => {
      const storage = createWebStorage(throwingStore);
      const result = await storage.get('session');

      expect(result.ok).toBe(false);
      // The whole point. If this ever equals { ok: true, value: null }, the
      // caller cannot tell "no account" from "cannot read the account", and
      // ensureSession will create a second one.
      expect(result).not.toEqual({ ok: true, value: null });
    });

    it('reports a failed write as ok:false', async () => {
      const storage = createWebStorage(throwingStore);
      expect((await storage.set('k', 'v')).ok).toBe(false);
    });

    it('reports a failed remove as ok:false', async () => {
      const storage = createWebStorage(throwingStore);
      expect((await storage.remove('k')).ok).toBe(false);
    });
  });

  describe('isDurable gates anonymous-user creation', () => {
    it('is true when a value round-trips', async () => {
      const storage = createWebStorage(workingStore);
      expect(await storage.isDurable()).toBe(true);
    });

    it('is false when the store throws', async () => {
      const storage = createWebStorage(throwingStore);
      expect(await storage.isDurable()).toBe(false);
    });

    it('is false when writes are silently discarded', async () => {
      // A presence check (`typeof localStorage !== 'undefined'`) passes here
      // and the store is still useless — which is why this round-trips a
      // probe instead.
      const storage = createWebStorage(amnesiacStore);
      expect(await storage.isDurable()).toBe(false);
    });

    it('leaves no probe key behind', async () => {
      const store = workingStore();
      const storage = createWebStorage(() => store);

      await storage.isDurable();

      expect(store.getItem('__10q_durability_probe__')).toBeNull();
    });
  });

  describe('round trip', () => {
    it('stores, reads and removes', async () => {
      const store = workingStore();
      const storage = createWebStorage(() => store);

      await storage.set('attempt_state', '{"index":3}');
      expect(await storage.get('attempt_state')).toEqual({
        ok: true,
        value: '{"index":3}',
      });

      await storage.remove('attempt_state');
      expect(await storage.get('attempt_state')).toEqual({ ok: true, value: null });
    });
  });
});
