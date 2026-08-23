import type { PushNotifications, PushPermission } from './types';

/**
 * No push on web.
 *
 * Web Push exists, but it needs a service worker, a VAPID key pair and its
 * own backend path — a separate workstream, not a free extra. The seam
 * reports 'denied' so callers can hide the setting rather than offering
 * something that will never arrive.
 */
const push: PushNotifications = {
  async checkPermission(): Promise<PushPermission> {
    return 'denied';
  },
  async requestPermissionAndRegister(): Promise<PushPermission> {
    return 'denied';
  },
  async unregister() {},
  onNotificationTap() {
    return () => {};
  },
};

export default push;
