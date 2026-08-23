import { PushNotifications as CapPush } from '@capacitor/push-notifications';
import type { PushNotifications, PushPermission } from './types';
import { edgeFunctions } from '@/lib/api/edge-functions';
import { APP_VERSION, APP_BUILD, CLIENT_PLATFORM } from '@/lib/version';

/**
 * Native push.
 *
 * Two things happen on registration and they are easy to conflate: the OS
 * grants permission, and THEN the provider issues a token asynchronously via
 * the `registration` event. The token is what the server needs, so this waits
 * for that event rather than assuming permission implies a token.
 */

/** Give the provider a bounded time to hand back a token. */
const REGISTRATION_TIMEOUT_MS = 15_000;

function toPermission(value: string): PushPermission {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'prompt';
}

/** The app version string, so the server knows which build owns the token. */
function appVersionTag(): string {
  return `${CLIENT_PLATFORM}/${APP_VERSION}+${APP_BUILD}`;
}

const push: PushNotifications = {
  async checkPermission() {
    try {
      const { receive } = await CapPush.checkPermissions();
      return toPermission(receive);
    } catch {
      return 'denied';
    }
  },

  async requestPermissionAndRegister() {
    try {
      const { receive } = await CapPush.requestPermissions();
      const permission = toPermission(receive);
      if (permission !== 'granted') return permission;

      // The token arrives on an event, not from register(). Wait for it, but
      // not forever — a provider that never answers should not hang the UI.
      const token = await new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (value: string | null) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        const timer = setTimeout(() => finish(null), REGISTRATION_TIMEOUT_MS);

        void CapPush.addListener('registration', (t) => {
          clearTimeout(timer);
          finish(t.value);
        });

        void CapPush.addListener('registrationError', () => {
          clearTimeout(timer);
          finish(null);
        });

        void CapPush.register();
      });

      if (!token) return 'granted'; // permission is real; the token is not

      await edgeFunctions.registerDeviceToken({
        token,
        platform: CLIENT_PLATFORM === 'android' ? 'android' : 'ios',
        app_version: appVersionTag(),
      });

      return 'granted';
    } catch {
      return 'denied';
    }
  },

  async unregister() {
    try {
      // Tell the server first: if the local removal succeeds and the server
      // call fails, the device keeps receiving notifications it can no longer
      // route. The other order fails safe.
      const { value } = await CapPush.checkPermissions().then(
        async () => ({ value: await currentToken() }),
      );
      if (value) {
        await edgeFunctions.registerDeviceToken({ token: value, unregister: true });
      }
      await CapPush.removeAllListeners();
    } catch {
      // Best effort — sign-out must not fail because of this.
    }
  },

  onNotificationTap(handler) {
    let removed = false;
    const handle = CapPush.addListener('pushNotificationActionPerformed', (action) => {
      const data = (action.notification.data ?? {}) as Record<string, string>;
      handler(data);
    });

    handle.then((h) => {
      if (removed) void h.remove();
    });

    return () => {
      removed = true;
      void handle.then((h) => h.remove());
    };
  },
};

/**
 * The token this device currently holds.
 *
 * Capacitor has no getter, so it is captured on the registration event and
 * cached. Returns null before the first successful registration.
 */
let lastKnownToken: string | null = null;
void CapPush.addListener('registration', (t) => {
  lastKnownToken = t.value;
});

async function currentToken(): Promise<string | null> {
  return lastKnownToken;
}

export default push;
