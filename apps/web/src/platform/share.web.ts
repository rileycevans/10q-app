import type { Share } from './types';

/**
 * Web share — the Web Share API where it exists, clipboard everywhere else.
 *
 * Returns false when the user dismissed the sheet so callers do not report
 * success for something that did not happen.
 */
const share: Share = {
  async share({ title, text, url }) {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return true;
      } catch (error) {
        // AbortError is the user closing the sheet — not a failure to report.
        if ((error as Error)?.name === 'AbortError') return false;
        // Anything else: fall through to the clipboard rather than lose the link.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  },
};

export default share;
