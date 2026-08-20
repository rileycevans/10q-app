import type { Lifecycle } from './types';

/**
 * Web lifecycle — Page Visibility and the online/offline events.
 *
 * `visibilitychange` is the closest web analogue to backgrounding: it fires
 * when the tab is hidden, which is when a server-timed countdown stops being
 * something the client can be trusted about.
 */
const lifecycle: Lifecycle = {
  onAppStateChange(listener) {
    if (typeof document === 'undefined') return () => {};
    const handler = () =>
      listener(document.visibilityState === 'visible' ? 'active' : 'background');
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },

  onNetworkChange(listener) {
    if (typeof window === 'undefined') return () => {};
    const online = () => listener(true);
    const offline = () => listener(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  },

  async isOnline() {
    // navigator.onLine only proves there is an interface up, not that anything
    // is reachable — but false is reliable, and that is the case worth acting on.
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  },
};

export default lifecycle;
