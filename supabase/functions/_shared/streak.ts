/**
 * Streak calculation for 10Q.
 *
 * A streak is a run of consecutive UTC calendar days on which the player
 * finalized the quiz released for that day. The `release_at_utc` on the
 * quiz, truncated to YYYY-MM-DD, is the canonical streak date.
 */

export interface StreakInput {
  /** YYYY-MM-DD of the quiz being finalized (from quiz.release_at_utc). */
  quizDate: string;
  /** YYYY-MM-DD of the player's previous streak-extending finalization, or null. */
  lastQuizDate: string | null;
  /** Player's current streak prior to this finalization. */
  previousCurrentStreak: number;
  /** Player's longest-ever streak. */
  previousLongestStreak: number;
}

export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
}

/**
 * Compute the new (currentStreak, longestStreak) after a finalize.
 *
 * Rules (match finalize-attempt edge function):
 * - No prior date → start at 1.
 * - Same date → no change to currentStreak (retake).
 * - Exactly yesterday (UTC) → currentStreak + 1.
 * - Any other gap → reset to 1.
 * - longestStreak is monotonic max.
 */
export function computeStreak(input: StreakInput): StreakResult {
  const { quizDate, lastQuizDate, previousCurrentStreak, previousLongestStreak } =
    input;

  let currentStreak = 1;

  if (lastQuizDate) {
    if (lastQuizDate === quizDate) {
      currentStreak = previousCurrentStreak;
    } else if (lastQuizDate === previousDayUtc(quizDate)) {
      currentStreak = previousCurrentStreak + 1;
    }
    // else: gap → remain at 1
  }

  const longestStreak = Math.max(previousLongestStreak, currentStreak);

  return { currentStreak, longestStreak };
}

/**
 * Given a YYYY-MM-DD string, return the previous UTC calendar day.
 * Accepts either "YYYY-MM-DD" or a full ISO string (only the date part is used).
 */
export function previousDayUtc(dateStr: string): string {
  const datePart = dateStr.slice(0, 10);
  const d = new Date(`${datePart}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Extract the UTC YYYY-MM-DD from an ISO timestamp.
 */
export function toUtcDateString(isoTimestamp: string): string {
  return new Date(isoTimestamp).toISOString().slice(0, 10);
}
