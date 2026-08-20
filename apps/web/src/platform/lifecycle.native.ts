import type { Lifecycle } from './types';
import webLifecycle from './lifecycle.web';

/**
 * Native lifecycle — @capacitor/app appStateChange and @capacitor/network.
 * Gated on 0E.
 *
 * Delegates to the web implementation meanwhile. Inside a WebView,
 * visibilitychange does fire on background/foreground, so this is a genuine
 * partial rather than a stub — the Capacitor events are more reliable and
 * fire in more cases, which is why they replace it later.
 */
const lifecycle: Lifecycle = {
  onAppStateChange(listener) {
    return webLifecycle.onAppStateChange(listener);
  },
  onNetworkChange(listener) {
    return webLifecycle.onNetworkChange(listener);
  },
  isOnline() {
    return webLifecycle.isOnline();
  },
};

export default lifecycle;
