import { App } from '@capacitor/app';
import type { Navigation } from './types';

/**
 * Native navigation — Android's hardware back button, and deep links.
 *
 * `backButton` fires on Android only; iOS has no hardware back and the
 * listener simply never fires there.
 *
 * The handler decides whether to consume the press. Returning false is not
 * "do nothing" — it means the app should exit, which is Android's default and
 * has to be requested explicitly once we have taken over the event.
 */
const navigation: Navigation = {
  onBack(handler) {
    let removed = false;
    const handle = App.addListener('backButton', () => {
      const consumed = handler();
      if (!consumed) void App.exitApp();
    });

    handle.then((h) => {
      if (removed) void h.remove();
    });

    return () => {
      removed = true;
      void handle.then((h) => h.remove());
    };
  },

  onDeepLink(handler) {
    let removed = false;
    const handle = App.addListener('appUrlOpen', ({ url }) => handler(url));

    handle.then((h) => {
      if (removed) void h.remove();
    });

    return () => {
      removed = true;
      void handle.then((h) => h.remove());
    };
  },
};

export default navigation;
