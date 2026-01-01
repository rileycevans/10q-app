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
} from "./constants.js";

export interface ScoreCalculation {
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  elapsedMs: number;
  isCorrect: boolean;
  isTimeout: boolean;
}

/**
 * Calculate bonus points based on elapsed time.
 * Linear bonus from 0-10 seconds, 0 after 10 seconds.
 * Rounded to nearest 0.5 using HALF_UP rounding.
 */
export function calculateBonus(elapsedMs: number): number {
  // Clamp elapsed time to bonus window
  const clamped = Math.min(Math.max(elapsedMs, 0), BONUS_WINDOW_MS);
  
  // Linear bonus: max at 0s, 0 at 10s
  const bonus = MAX_BONUS_POINTS * (1 - clamped / BONUS_WINDOW_MS);
  
  // Round to nearest 0.5 (HALF_UP)
  return Math.round(bonus * 2) / 2;
}

/**
 * Calculate score for a single question.
 * 
 * @param isCorrect - Whether the answer was correct
 * @param elapsedMs - Time elapsed in milliseconds (0-16000)
 * @param isTimeout - Whether the question timed out (no answer within 16s)
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
  
  // Bonus points: linear from 0-10s, 0 after 10s
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

