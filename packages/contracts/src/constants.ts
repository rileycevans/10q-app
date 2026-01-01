/**
 * Scoring and timing constants for 10Q game.
 * All constants are defined here to prevent magic numbers in code.
 */

export const QUESTION_TIME_LIMIT_MS = 16000;
export const BONUS_WINDOW_MS = 10000;
export const BASE_POINTS_CORRECT = 5;
export const BASE_POINTS_INCORRECT = 0;
export const MAX_BONUS_POINTS = 5;
export const SCORING_VERSION = 1;

export const MAX_QUESTIONS_PER_QUIZ = 10;
export const CHOICES_PER_QUESTION = 4;
export const MIN_TAGS_PER_QUESTION = 1;
export const MAX_TAGS_PER_QUESTION = 5;

export const MAX_SCORE_PER_QUESTION = BASE_POINTS_CORRECT + MAX_BONUS_POINTS;
export const MAX_TOTAL_SCORE = MAX_QUESTIONS_PER_QUIZ * MAX_SCORE_PER_QUESTION;

