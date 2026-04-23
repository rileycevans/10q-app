/**
 * Scoring formula implementation.
 * This is the single source of truth for all scoring calculations.
 * Must be imported and reused by Edge Functions and tests.
 */

import {
  BASE_POINTS_CORRECT,
  BASE_POINTS_INCORRECT,
  MAX_BONUS_POINTS,
  BONUS_WINDOW_MS,
  QUESTION_TIME_LIMIT_MS,
  MAX_QUESTIONS_PER_QUIZ,
  MAX_SCORE_PER_QUESTION,
} from "./constants";

export interface ScoreCalculation {
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  elapsedMs: number;
  isCorrect: boolean;
  isTimeout: boolean;
}

/**
 * Calculate bonus points based on elapsed time using step-based tiers.
 * Step-based bonus tiers:
 * - 0–3s: 5 bonus
 * - 3–5s: 4 bonus
 * - 5–7s: 3 bonus
 * - 7–9s: 2 bonus
 * - 9–11s: 1 bonus
 * - 11s+: 0 bonus
 */
export function calculateBonus(elapsedMs: number): number {
  // Clamp elapsed time to bonus window
  const clamped = Math.min(Math.max(elapsedMs, 0), BONUS_WINDOW_MS);

  // Convert to seconds
  const elapsedSeconds = clamped / 1000;

  if (elapsedSeconds < 3) {
    return 5;
  } else if (elapsedSeconds < 5) {
    return 4;
  } else if (elapsedSeconds < 7) {
    return 3;
  } else if (elapsedSeconds < 9) {
    return 2;
  } else if (elapsedSeconds < 11) {
    return 1;
  } else {
    return 0;
  }
}

/**
 * Calculate score for a single question.
 *
 * @param isCorrect - Whether the answer was correct
 * @param elapsedMs - Time elapsed in milliseconds (0-12000)
 * @param isTimeout - Whether the question timed out (no answer within 12s)
 * @returns Score calculation with base, bonus, and total points
 */
export function calculateQuestionScore(
  isCorrect: boolean,
  elapsedMs: number,
  isTimeout: boolean = false
): ScoreCalculation {
  // Clamp elapsed time to valid range
  const clampedElapsedMs = Math.min(Math.max(elapsedMs, 0), QUESTION_TIME_LIMIT_MS);
  
  // Timeout: no points
  if (isTimeout) {
    return {
      basePoints: BASE_POINTS_INCORRECT,
      bonusPoints: 0,
      totalPoints: 0,
      elapsedMs: QUESTION_TIME_LIMIT_MS,
      isCorrect: false,
      isTimeout: true,
    };
  }
  
  // Base points: 5 if correct, 0 if incorrect
  const basePoints = isCorrect ? BASE_POINTS_CORRECT : BASE_POINTS_INCORRECT;

  // Bonus points: step-based tiers from 0-7.5s, 0 after 7.5s
  const bonusPoints = isCorrect ? calculateBonus(clampedElapsedMs) : 0;
  
  return {
    basePoints,
    bonusPoints,
    totalPoints: basePoints + bonusPoints,
    elapsedMs: clampedElapsedMs,
    isCorrect,
    isTimeout: false,
  };
}

/**
 * Validate that a total score is within valid bounds.
 */
export function validateTotalScore(totalScore: number): boolean {
  return totalScore >= 0 && totalScore <= MAX_QUESTIONS_PER_QUIZ * MAX_SCORE_PER_QUESTION;
}

