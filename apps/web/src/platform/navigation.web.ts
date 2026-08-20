import type { Navigation } from './types';

/**
 * Web navigation.
 *
 * There is no hardware back button, and hijacking browser back would break the
 * one navigation affordance web users already have — so `onBack` is a no-op
 * that returns an unsubscribe. Deep links arrive as ordinary URLs the router
 * already handles, so `onDeepLink` never fires here.
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
