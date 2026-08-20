import type { Navigation } from './types';

/**
 * Native navigation — @capacitor/app back button and appUrlOpen. Gated on 0E.
 *
 * Returns unsubscribes that do nothing, so callers can register handlers now
 * without a null check that would have to be removed later.
 */
const navigation: Navigation = {
  onBack() {
    return () => {};
  },
  onDeepLink() {
    return () => {};
  },
};

export default navigation;
