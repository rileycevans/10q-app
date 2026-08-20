import type { AppInfo } from './types';
import { APP_VERSION, APP_BUILD, CLIENT_PLATFORM } from '@/lib/version';

/**
 * Native build identity.
 *
 * Reads the same build-time constants as web rather than @capacitor/app's
 * getInfo(), so the version a crash report carries is the one the release
 * pipeline stamped. getInfo() reads the bundle's Info.plist, which is set by
 * `version.mjs apply-native` from the same source — but going through the
 * constants keeps one path instead of two that can disagree.
 */
const appInfo: AppInfo = {
  platform: CLIENT_PLATFORM,
  version: APP_VERSION,
  build: APP_BUILD,
  isNative: true,
};

export default appInfo;
