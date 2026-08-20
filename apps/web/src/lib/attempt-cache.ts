import { storage } from '@/platform';

/**
 * Mid-quiz recovery cache.
 *
 * Previously `sessionStorage`, which does not survive a WebView process kill —
 * and on mobile that is the normal interruption, not an edge case. A player
 * who takes a phone call mid-quiz comes back to a tab the OS discarded; with
 * sessionStorage their attempt id is gone and the finalize screen has to
 * re-discover it from the server.
 *
 * Durable storage instead: localStorage on web, Preferences on native.
 *
 * `quiz_id` and `quiz_questions` used to be written alongside this and were
 * never read by anything — deleted rather than migrated. The questions blob
 * in particular was the largest thing in storage, rewritten on every quiz
 * load, and read by nobody.
 *
 * Writes are fire-and-forget: this is a cache, and failing to write it costs
 * a server round trip on recovery rather than anything a player notices.
 * Failing loudly here would turn a degraded-but-working state into a broken one.
 */

const KEY = 'attempt_state';

export function cacheAttemptState(attempt: unknown): void {
  void storage.set(KEY, JSON.stringify(attempt));
}

export async function readCachedAttemptId(): Promise<string | null> {
  const result = await storage.get(KEY);
  // ok:false means storage is unreadable, which is not the same as "no cached
  // attempt" — but for a recovery cache both lead to the same fallback, so
  // there is nothing to distinguish here. The distinction matters where it
  // decides whether to create an account; see lib/auth.ts.
  if (!result.ok || !result.value) return null;

  try {
    return (JSON.parse(result.value) as { attempt_id?: string }).attempt_id ?? null;
  } catch {
    return null;
  }
}

export function clearCachedAttempt(): void {
  void storage.remove(KEY);
}
