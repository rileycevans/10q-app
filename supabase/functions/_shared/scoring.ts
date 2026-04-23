/**
 * Scoring formula for 10Q. Mirrors `@10q/contracts/scoring` — duplicated here
 * because Deno edge functions cannot import from the Node workspace packages.
 * If you change one, change the other.
 */

export const BASE_POINTS_CORRECT = 5;
export const BASE_POINTS_INCORRECT = 0;
export const MAX_BONUS_POINTS = 5;
export const BONUS_WINDOW_MS = 11000;
export const QUESTION_TIME_LIMIT_MS = 12000;

export interface ScoreCalculation {
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  elapsedMs: number;
}

/**
 * Step-based bonus tiers:
 * - [0, 3s):   5
 * - [3s, 5s):  4
 * - [5s, 7s):  3
 * - [7s, 9s):  2
 * - [9s, 11s): 1
 * - [11s, ∞):  0
 */
export function calculateBonus(elapsedMs: number): number {
  const clamped = Math.min(Math.max(elapsedMs, 0), BONUS_WINDOW_MS);
  const elapsedSeconds = clamped / 1000;

  if (elapsedSeconds < 3) return 5;
  if (elapsedSeconds < 5) return 4;
  if (elapsedSeconds < 7) return 3;
  if (elapsedSeconds < 9) return 2;
  if (elapsedSeconds < 11) return 1;
  return 0;
}

export function calculateQuestionScore(
  isCorrect: boolean,
  elapsedMs: number,
  isTimeout: boolean,
): ScoreCalculation {
  const clampedElapsedMs = Math.min(
    Math.max(elapsedMs, 0),
    QUESTION_TIME_LIMIT_MS,
  );

  if (isTimeout) {
    return {
      basePoints: BASE_POINTS_INCORRECT,
      bonusPoints: 0,
      totalPoints: 0,
      elapsedMs: QUESTION_TIME_LIMIT_MS,
    };
  }

  const basePoints = isCorrect ? BASE_POINTS_CORRECT : BASE_POINTS_INCORRECT;
  const bonusPoints = isCorrect ? calculateBonus(clampedElapsedMs) : 0;

  return {
    basePoints,
    bonusPoints,
    totalPoints: basePoints + bonusPoints,
    elapsedMs: clampedElapsedMs,
  };
}

/**
 * Server-authoritative elapsed time between question start and submission.
 * Returns a clamped non-negative elapsed value and a timeout flag.
 */
export function computeElapsed(
  questionStartedAtIso: string,
  nowMs: number,
): { elapsedMs: number; isTimeout: boolean } {
  const startedAtMs = new Date(questionStartedAtIso).getTime();
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const isTimeout = elapsedMs >= QUESTION_TIME_LIMIT_MS;
  return { elapsedMs, isTimeout };
}
