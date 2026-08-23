/**
 * One clock, reconciled against the server.
 *
 * The game is server-timed: each question carries a `question_expires_at`
 * the server issued, and the countdown is `expiry - now`. If `now` comes from
 * the device clock, a player whose phone is wrong sees a wrong countdown —
 * fast clock burns their time, slow clock shows time they do not have and the
 * server rejects the answer as expired. Neither is visible as an error; it
 * just feels broken.
 *
 * That is not hypothetical on mobile. A phone that has been off, one crossing
 * timezones, a manual clock change, or a device that never reached NTP will
 * all drift.
 *
 * Rather than add a probe endpoint, the offset is measured from the `Date`
 * header every Edge Function response already carries, corrected for round
 * trip:
 *
 *     offset = serverDate + (rtt / 2) - clientMidpoint
 *
 * Half the round trip is the standard approximation for one-way latency. It
 * assumes a symmetric path, which is wrong in detail and close enough for a
 * 12-second timer.
 *
 * Everything degrades safely: with no measurement, `now()` is `Date.now()`
 * and behaviour is exactly what it was before.
 */

/** Smallest offset worth correcting. Below this the RTT estimate dominates. */
const SIGNIFICANT_DRIFT_MS = 750;

/** Ignore absurd measurements — a proxy with a broken clock, a cached response. */
const MAX_PLAUSIBLE_OFFSET_MS = 24 * 60 * 60 * 1000;

/** A slow request makes rtt/2 a poor estimate; prefer the existing offset. */
const MAX_USEFUL_RTT_MS = 4000;

let offsetMs = 0;
let measured = false;
let bestRttMs = Number.POSITIVE_INFINITY;

/**
 * Record a measurement from a completed request.
 *
 * Keeps the sample with the lowest round trip rather than the most recent:
 * the fastest exchange has the least uncertainty, which is the same reason
 * NTP prefers low-delay samples.
 */
export function observeServerDate(
  dateHeader: string | null,
  requestStartedAt: number,
  requestEndedAt: number,
): void {
  if (!dateHeader) return;

  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) return;

  const rtt = requestEndedAt - requestStartedAt;
  if (rtt < 0 || rtt > MAX_USEFUL_RTT_MS) return;
  if (rtt >= bestRttMs) return;

  const clientMidpoint = requestStartedAt + rtt / 2;
  const candidate = serverMs + rtt / 2 - clientMidpoint;

  if (Math.abs(candidate) > MAX_PLAUSIBLE_OFFSET_MS) return;

  bestRttMs = rtt;
  offsetMs = candidate;
  measured = true;
}

/**
 * The current time, corrected toward the server.
 *
 * Small offsets are ignored: the `Date` header has one-second resolution, so
 * sub-second "drift" is measurement noise and correcting for it would make
 * the countdown jitter for no reason.
 */
export function now(): number {
  if (!measured || Math.abs(offsetMs) < SIGNIFICANT_DRIFT_MS) return Date.now();
  return Date.now() + offsetMs;
}

/** Diagnostics — for logging a real drift, not for game logic. */
export function clockState(): {
  measured: boolean;
  offsetMs: number;
  bestRttMs: number | null;
  correcting: boolean;
} {
  return {
    measured,
    offsetMs: Math.round(offsetMs),
    bestRttMs: Number.isFinite(bestRttMs) ? Math.round(bestRttMs) : null,
    correcting: measured && Math.abs(offsetMs) >= SIGNIFICANT_DRIFT_MS,
  };
}

/** Test seam. */
export function __resetServerClock(): void {
  offsetMs = 0;
  measured = false;
  bestRttMs = Number.POSITIVE_INFINITY;
}
