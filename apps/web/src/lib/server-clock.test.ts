import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  observeServerDate,
  now,
  clockState,
  __resetServerClock,
} from './server-clock';

/**
 * The offset arithmetic decides how much time a player sees on a
 * server-authoritative 12-second timer. Getting the sign wrong would show
 * everyone the wrong countdown, and it would look like a game bug rather than
 * a clock bug.
 */

describe('server clock', () => {
  beforeEach(() => {
    __resetServerClock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetServerClock();
  });

  /** Pin the device clock so offsets are exactly assertable. */
  function setDeviceTime(ms: number) {
    vi.setSystemTime(new Date(ms));
  }

  describe('before any measurement', () => {
    it('falls back to the device clock', () => {
      setDeviceTime(1_700_000_000_000);
      expect(now()).toBe(1_700_000_000_000);
      expect(clockState().measured).toBe(false);
    });
  });

  describe('offset measurement', () => {
    it('detects a device clock running behind the server', () => {
      // Device says 10:00:00. Server says 10:00:30. 100ms round trip.
      const deviceStart = 1_700_000_000_000;
      const serverDate = new Date(deviceStart + 30_000).toUTCString();
      setDeviceTime(deviceStart + 100);

      observeServerDate(serverDate, deviceStart, deviceStart + 100);

      // ~30s ahead, within the second of Date-header resolution.
      expect(clockState().offsetMs).toBeGreaterThan(29_000);
      expect(clockState().offsetMs).toBeLessThan(31_000);
      expect(clockState().correcting).toBe(true);
    });

    it('detects a device clock running ahead of the server', () => {
      const deviceStart = 1_700_000_000_000;
      const serverDate = new Date(deviceStart - 45_000).toUTCString();
      setDeviceTime(deviceStart + 100);

      observeServerDate(serverDate, deviceStart, deviceStart + 100);

      // Negative: the correction pulls time backwards.
      expect(clockState().offsetMs).toBeLessThan(-44_000);
      expect(clockState().offsetMs).toBeGreaterThan(-46_000);
    });

    it('corrects now() by the measured offset', () => {
      const deviceStart = 1_700_000_000_000;
      observeServerDate(
        new Date(deviceStart + 30_000).toUTCString(),
        deviceStart,
        deviceStart + 100,
      );

      setDeviceTime(deviceStart);
      // Roughly 30s later than the device believes.
      expect(now()).toBeGreaterThan(deviceStart + 29_000);
      expect(now()).toBeLessThan(deviceStart + 31_000);
    });
  });

  describe('noise rejection', () => {
    it('ignores sub-second drift', () => {
      // The Date header has one-second resolution, so a fraction of a second
      // is measurement noise. Correcting for it would make the countdown
      // jitter with no benefit.
      const deviceStart = 1_700_000_000_000;
      observeServerDate(new Date(deviceStart).toUTCString(), deviceStart, deviceStart + 50);

      setDeviceTime(deviceStart);
      expect(now()).toBe(deviceStart);
      expect(clockState().correcting).toBe(false);
    });

    it('ignores a missing Date header', () => {
      observeServerDate(null, 1_700_000_000_000, 1_700_000_000_100);
      expect(clockState().measured).toBe(false);
    });

    it('ignores an unparseable Date header', () => {
      observeServerDate('not a date', 1_700_000_000_000, 1_700_000_000_100);
      expect(clockState().measured).toBe(false);
    });

    it('ignores an implausible offset', () => {
      // A year of drift is a broken proxy or a cached response, not a clock.
      const deviceStart = 1_700_000_000_000;
      observeServerDate(
        new Date(deviceStart + 365 * 24 * 60 * 60 * 1000).toUTCString(),
        deviceStart,
        deviceStart + 100,
      );
      expect(clockState().measured).toBe(false);
    });

    it('ignores a very slow request', () => {
      // rtt/2 is only a good estimate when the round trip is short.
      const deviceStart = 1_700_000_000_000;
      observeServerDate(
        new Date(deviceStart + 30_000).toUTCString(),
        deviceStart,
        deviceStart + 30_000,
      );
      expect(clockState().measured).toBe(false);
    });
  });

  describe('sample selection', () => {
    it('keeps the lowest-latency sample rather than the most recent', () => {
      const deviceStart = 1_700_000_000_000;

      // Fast sample first.
      observeServerDate(
        new Date(deviceStart + 30_000).toUTCString(),
        deviceStart,
        deviceStart + 40,
      );
      const fastRtt = clockState().bestRttMs;

      // A slower one later must not displace it — more latency means more
      // uncertainty in the one-way estimate.
      observeServerDate(
        new Date(deviceStart + 30_000).toUTCString(),
        deviceStart,
        deviceStart + 2_000,
      );

      expect(clockState().bestRttMs).toBe(fastRtt);
    });

    it('accepts a faster sample', () => {
      const deviceStart = 1_700_000_000_000;
      observeServerDate(new Date(deviceStart + 30_000).toUTCString(), deviceStart, deviceStart + 900);
      observeServerDate(new Date(deviceStart + 30_000).toUTCString(), deviceStart, deviceStart + 60);
      expect(clockState().bestRttMs).toBe(60);
    });
  });
});
