/**
 * First-run tutorial state.
 *
 * Storage:
 *  - tutorial_anon_views (localStorage, integer): how many times an
 *    anonymous user has opened the tutorial. Capped at 2; on the third
 *    anonymous visit it doesn't appear.
 *  - tutorial_completed_for_user (localStorage, '1' | absent): once a user
 *    has signed in (or completed the flow), this flag suppresses the
 *    tutorial forever on this device — even if they sign out later and
 *    return as anonymous.
 *  - tutorial_resume (localStorage, 'handle' | absent): set just before
 *    OAuth redirect so we can resume at the handle step after the round-
 *    trip lands back on /. Cleared after consumption.
 *
 * Anything localStorage-scoped is per-device by design; cross-device
 * persistence would require a `players.tutorial_seen_at` column and we
 * intentionally avoided that to ship today without a migration.
 */

const VIEW_COUNT_KEY = 'tutorial_anon_views';
const COMPLETED_KEY = 'tutorial_completed_for_user';
const RESUME_KEY = 'tutorial_resume';
const MAX_ANON_VIEWS = 2;

export type TutorialResumeStep = 'handle';

function readNumber(key: string): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(key);
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function readFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(key) === '1';
}

/**
 * Decide whether to open the tutorial on home-page mount.
 *
 * Returns:
 *  - 'fresh' — open at step 1
 *  - 'resume_handle' — open at the handle step (post-OAuth redirect)
 *  - null — don't open
 */
export function tutorialOnMount(opts: {
  isAnonymous: boolean;
  isSignedIn: boolean;
}): 'fresh' | 'resume_handle' | null {
  if (typeof window === 'undefined') return null;

  // Resume takes priority — if we're coming back from OAuth, jump straight
  // to the handle step regardless of view count.
  const resume = window.localStorage.getItem(RESUME_KEY);
  if (resume === 'handle' && opts.isSignedIn && !opts.isAnonymous) {
    return 'resume_handle';
  }

  // Hard suppress: signed in (not anonymous) means they've already gone
  // through the tutorial or don't need it. Lock it off for this device.
  if (opts.isSignedIn && !opts.isAnonymous) {
    markCompletedForUser();
    return null;
  }

  // If we've ever marked completed, never show again — even if the user
  // signs out and comes back anonymous.
  if (readFlag(COMPLETED_KEY)) return null;

  // Anonymous + view budget remaining → show.
  if (opts.isAnonymous && readNumber(VIEW_COUNT_KEY) < MAX_ANON_VIEWS) {
    return 'fresh';
  }

  return null;
}

/**
 * Call when the tutorial first appears for an anonymous user. Counts
 * against the two-view budget. Idempotent within a single mount because
 * the home page only opens the tutorial once per mount.
 */
export function recordAnonymousView(): void {
  if (typeof window === 'undefined') return;
  const next = readNumber(VIEW_COUNT_KEY) + 1;
  window.localStorage.setItem(VIEW_COUNT_KEY, String(next));
}

/**
 * Mark the tutorial as done for this device. Called when a user signs in
 * (the whole point of the tutorial) or completes the handle step. After
 * this, tutorialOnMount returns null forever — even for anonymous sessions
 * on this device.
 */
export function markCompletedForUser(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(COMPLETED_KEY, '1');
  // Also clear any stale resume hint so a future OAuth doesn't re-trigger.
  window.localStorage.removeItem(RESUME_KEY);
}

/**
 * Set the resume hint just before kicking off OAuth from inside the
 * tutorial. The post-redirect home-page mount will see this and open the
 * tutorial at the handle step.
 */
export function setResumeAfterOAuth(step: TutorialResumeStep): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RESUME_KEY, step);
}

/**
 * Consume the resume hint. Call this once the tutorial has actually
 * reopened at the resumed step so we don't keep resuming on every mount.
 */
export function consumeResumeHint(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(RESUME_KEY);
}

/**
 * Test helper — only used from /dev routes or e2e setup. Not exported
 * through any public surface.
 */
export function resetTutorialStateForTesting(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(VIEW_COUNT_KEY);
  window.localStorage.removeItem(COMPLETED_KEY);
  window.localStorage.removeItem(RESUME_KEY);
}
