import type { AppInfo } from './types';
import { APP_VERSION, APP_BUILD, CLIENT_PLATFORM } from '@/lib/version';

/**
 * Build identity, from the same constants Sentry and PostHog report.
 * One source of truth, so a crash report and a support conversation cannot
 * disagree about which build someone is running.
 */
const appInfo: AppInfo = {
  platform: CLIENT_PLATFORM,
  version: APP_VERSION,
  build: APP_BUILD,
  isNative: false,
};

export default appInfo;
