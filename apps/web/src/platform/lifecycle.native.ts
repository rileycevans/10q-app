import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import type { Lifecycle } from './types';

/**
 * Native lifecycle.
 *
 * Capacitor's appStateChange rather than visibilitychange: the WebView is not
 * reliably told it is hidden when the OS suspends the app, and on a
 * server-timed game the resume moment is exactly when the client's clock is
 * least trustworthy. A player who backgrounds mid-question comes back to a
 * countdown that kept running on the server.
 *
 * Listeners register asynchronously, so the unsubscribe has to wait for the
 * handle. Returning a function that removes it once resolved keeps the
 * caller's cleanup synchronous and race-free — an immediate unmount still
 * removes the listener rather than leaking it.
 */
const lifecycle: Lifecycle = {
  onAppStateChange(listener) {
    let removed = false;
    const handle = App.addListener('appStateChange', ({ isActive }) => {
      listener(isActive ? 'active' : 'background');
    });

    handle.then((h) => {
      if (removed) void h.remove();
    });

    return () => {
      removed = true;
      void handle.then((h) => h.remove());
    };
  },

  onNetworkChange(listener) {
    let removed = false;
    const handle = Network.addListener('networkStatusChange', (status) => {
      listener(status.connected);
    });

    handle.then((h) => {
      if (removed) void h.remove();
    });

    return () => {
      removed = true;
      void handle.then((h) => h.remove());
    };
  },

  async isOnline() {
    try {
      return (await Network.getStatus()).connected;
    } catch {
      // Assume online: a false negative here would block requests that would
      // otherwise have worked.
      return true;
    }
  },
};

export default lifecycle;
