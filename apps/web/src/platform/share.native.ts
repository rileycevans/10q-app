import { Share as CapShare } from '@capacitor/share';
import type { Share } from './types';
import webShare from './share.web';

/**
 * Native share — the system share sheet.
 *
 * Falls back to the web implementation (Web Share API, then clipboard) if the
 * sheet is unavailable, so an invite link is never simply lost. The URL is
 * already an absolute play10q.com address via PUBLIC_ORIGIN — sharing
 * capacitor://localhost would give a friend a link that cannot open.
 */
const share: Share = {
  async share({ title, text, url }) {
    try {
      await CapShare.share({ title, text, url, dialogTitle: title });
      return true;
    } catch (error) {
      // The user dismissing the sheet is not a failure to report, and must
      // not fall through to silently copying instead.
      const message = (error as Error)?.message?.toLowerCase() ?? '';
      if (message.includes('cancel') || message.includes('abort')) return false;

      return webShare.share({ title, text, url });
    }
  },
};

export default share;
