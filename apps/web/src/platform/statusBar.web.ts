/**
 * No status bar on web — the browser owns its own chrome.
 *
 * Exists so callers can invoke it unconditionally instead of branching on
 * platform, which is the whole point of the seam.
 */
export async function configureStatusBar(): Promise<void> {}
