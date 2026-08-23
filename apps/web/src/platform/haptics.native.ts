import { Haptics as CapHaptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { Haptics } from './types';

/**
 * Native haptics.
 *
 * Every call is swallowed on failure. Haptics are decoration — a device with
 * the Taptic Engine disabled, or an Android without a vibrator, must not turn
 * a missing buzz into a failed answer submission.
 */
const haptics: Haptics = {
  async impact(style = 'light') {
    try {
      await CapHaptics.impact({
        style:
          style === 'heavy'
            ? ImpactStyle.Heavy
            : style === 'medium'
              ? ImpactStyle.Medium
              : ImpactStyle.Light,
      });
    } catch {
      /* no haptics available */
    }
  },

  async notification(type) {
    try {
      await CapHaptics.notification({
        type:
          type === 'error'
            ? NotificationType.Error
            : type === 'warning'
              ? NotificationType.Warning
              : NotificationType.Success,
      });
    } catch {
      /* no haptics available */
    }
  },
};

export default haptics;
