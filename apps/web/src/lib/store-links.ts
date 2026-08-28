/**
 * Where to send someone who wants the app.
 *
 * These are null until each store listing exists. /get degrades to the
 * playable website for any platform whose link is still null, so the page
 * works from the day it ships rather than only after both stores are live.
 *
 * Deliberately env-overridable: the share text that carries this link is
 * baked into every installed binary, and store binaries stay installed for
 * months (CLAUDE.md rule 5). Pointing shares at /get rather than at a store
 * URL means the destination stays changeable — iOS can go live weeks before
 * Android without anyone needing to update their app.
 */

/** Apple App Store listing, once the app record exists. */
export const APP_STORE_URL: string | null =
  process.env.NEXT_PUBLIC_APP_STORE_URL ?? null;

/** Google Play listing, once the Console account and app exist. */
export const PLAY_STORE_URL: string | null =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? null;

/** True once at least one store link is live. */
export const HAS_ANY_STORE_LINK = Boolean(APP_STORE_URL || PLAY_STORE_URL);
