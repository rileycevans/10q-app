import type { Haptics } from './types';

/**
 * No haptics on web.
 *
 * Deliberately not the Vibration API: it is unsupported on iOS Safari,
 * requires a user gesture on Android, and a buzzing browser tab is not what
 * the native feedback is for. Silence is the correct web behaviour, and the
 * no-op keeps callers from needing to know that.
 */
const haptics: Haptics = {
  async impact() {},
  async notification() {},
};

export default haptics;
