import type { Share } from './types';

/**
 * Native share — @capacitor/share (system share sheet). Gated on 0E.
 *
 * Falls back to the web clipboard path meanwhile, so invite links still work
 * inside a shell build. The URL is already absolute via PUBLIC_ORIGIN.
 */
import webShare from './share.web';

const share: Share = {
  async share(options) {
    return webShare.share(options);
  },
};

export default share;
