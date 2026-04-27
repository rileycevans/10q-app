/**
 * Time utilities for the daily quiz cycle.
 *
 * A new quiz is released every day at 11:30 UTC. These helpers compute
 * the time until the next release in a single place so the cutoff isn't
 * duplicated across pages.
 */

/** UTC hour at which the next quiz is released. */
export const QUIZ_RELEASE_UTC_HOUR = 11;
/** UTC minute at which the next quiz is released. */
export const QUIZ_RELEASE_UTC_MINUTE = 30;

export interface CountdownParts {
  /** Whole hours until next release. */
  hours: number;
  /** Whole minutes (0–59) within the remaining hour. */
  minutes: number;
  /** Whole seconds (0–59) within the remaining minute. */
  seconds: number;
  /** Total milliseconds until the next release. */
  totalMs: number;
}

/**
 * Compute the next release Date (UTC).
 * If `now` is on/after today's release, the result is tomorrow's release.
 */
export function getNextQuizReleaseAt(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setUTCHours(QUIZ_RELEASE_UTC_HOUR, QUIZ_RELEASE_UTC_MINUTE, 0, 0);
  const releasedToday =
    now.getUTCHours() > QUIZ_RELEASE_UTC_HOUR ||
    (now.getUTCHours() === QUIZ_RELEASE_UTC_HOUR &&
      now.getUTCMinutes() >= QUIZ_RELEASE_UTC_MINUTE);
  if (releasedToday) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * Break the time until the next quiz release into hours/minutes/seconds.
 */
export function getTimeUntilNextQuiz(now: Date = new Date()): CountdownParts {
  const totalMs = Math.max(0, getNextQuizReleaseAt(now).getTime() - now.getTime());
  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);
  return { hours, minutes, seconds, totalMs };
}

/**
 * Render a countdown as `Xh Ym Zs` — the format used everywhere in the UI.
 */
export function formatCountdown(parts: CountdownParts): string {
  return `${parts.hours}h ${parts.minutes}m ${parts.seconds}s`;
}

/**
 * Convenience: compute and format the countdown to the next quiz release in one call.
 */
export function formatTimeUntilNextQuiz(now: Date = new Date()): string {
  return formatCountdown(getTimeUntilNextQuiz(now));
}
