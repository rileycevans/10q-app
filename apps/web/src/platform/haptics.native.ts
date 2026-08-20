import type { Haptics } from './types';

/**
 * Native haptics — @capacitor/haptics. Gated on 0E.
 *
 * No-ops rather than throws: haptics are decoration, and a missing buzz must
 * never break an answer submission.
 */
const haptics: Haptics = {
  async impact() {},
  async notification() {},
};

export default haptics;
