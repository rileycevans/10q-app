/**
 * Unit tests for scoring formula.
 * Tests all edge cases and ensures formula matches spec exactly.
 */

import { describe, it, expect } from "vitest";
import {
  calculateBonus,
  calculateQuestionScore,
  validateTotalScore,
} from "./scoring.js";
import {
  BASE_POINTS_CORRECT,
  BASE_POINTS_INCORRECT,
  MAX_BONUS_POINTS,
  BONUS_WINDOW_MS,
  QUESTION_TIME_LIMIT_MS,
  MAX_QUESTIONS_PER_QUIZ,
  MAX_SCORE_PER_QUESTION,
} from "./constants.js";

describe("calculateBonus", () => {
  it("returns max bonus at 0ms", () => {
    const bonus = calculateBonus(0);
    expect(bonus).toBe(MAX_BONUS_POINTS);
  });

  it("returns 0 bonus at 10s (bonus window end)", () => {
    const bonus = calculateBonus(BONUS_WINDOW_MS);
    expect(bonus).toBe(0);
  });

  it("returns 0 bonus after 10s", () => {
    const bonus = calculateBonus(BONUS_WINDOW_MS + 1000);
    expect(bonus).toBe(0);
  });

  it("returns half bonus at 5s (midpoint)", () => {
    const bonus = calculateBonus(5000);
    expect(bonus).toBe(2.5);
  });

  it("rounds to nearest 0.5", () => {
    // At 1 second: 5 * (1 - 1000/10000) = 5 * 0.9 = 4.5
    const bonus = calculateBonus(1000);
    expect(bonus).toBe(4.5);
  });

  it("clamps negative values to 0", () => {
    const bonus = calculateBonus(-1000);
    expect(bonus).toBe(MAX_BONUS_POINTS);
  });

  it("clamps values above bonus window", () => {
    const bonus = calculateBonus(20000);
    expect(bonus).toBe(0);
  });
});

describe("calculateQuestionScore", () => {
  describe("correct answers", () => {
    it("calculates max score at 0ms", () => {
      const result = calculateQuestionScore(true, 0);
      expect(result.basePoints).toBe(BASE_POINTS_CORRECT);
      expect(result.bonusPoints).toBe(MAX_BONUS_POINTS);
      expect(result.totalPoints).toBe(BASE_POINTS_CORRECT + MAX_BONUS_POINTS);
      expect(result.isCorrect).toBe(true);
      expect(result.isTimeout).toBe(false);
    });

    it("calculates score at 5s (half bonus)", () => {
      const result = calculateQuestionScore(true, 5000);
      expect(result.basePoints).toBe(BASE_POINTS_CORRECT);
      expect(result.bonusPoints).toBe(2.5);
      expect(result.totalPoints).toBe(7.5);
    });

    it("calculates score at 10s (no bonus)", () => {
      const result = calculateQuestionScore(true, BONUS_WINDOW_MS);
      expect(result.basePoints).toBe(BASE_POINTS_CORRECT);
      expect(result.bonusPoints).toBe(0);
      expect(result.totalPoints).toBe(BASE_POINTS_CORRECT);
    });

    it("calculates score after 10s (no bonus, still correct)", () => {
      const result = calculateQuestionScore(true, 15000);
      expect(result.basePoints).toBe(BASE_POINTS_CORRECT);
      expect(result.bonusPoints).toBe(0);
      expect(result.totalPoints).toBe(BASE_POINTS_CORRECT);
    });
  });

  describe("incorrect answers", () => {
    it("returns 0 points for incorrect answer", () => {
      const result = calculateQuestionScore(false, 0);
      expect(result.basePoints).toBe(BASE_POINTS_INCORRECT);
      expect(result.bonusPoints).toBe(0);
      expect(result.totalPoints).toBe(0);
      expect(result.isCorrect).toBe(false);
    });

    it("returns 0 points regardless of time for incorrect", () => {
      const result = calculateQuestionScore(false, 5000);
      expect(result.basePoints).toBe(BASE_POINTS_INCORRECT);
      expect(result.bonusPoints).toBe(0);
      expect(result.totalPoints).toBe(0);
    });
  });

  describe("timeout", () => {
    it("returns 0 points for timeout", () => {
      const result = calculateQuestionScore(false, QUESTION_TIME_LIMIT_MS, true);
      expect(result.basePoints).toBe(BASE_POINTS_INCORRECT);
      expect(result.bonusPoints).toBe(0);
      expect(result.totalPoints).toBe(0);
      expect(result.isCorrect).toBe(false);
      expect(result.isTimeout).toBe(true);
      expect(result.elapsedMs).toBe(QUESTION_TIME_LIMIT_MS);
    });
  });

  describe("edge cases", () => {
    it("clamps elapsed time to valid range", () => {
      const result = calculateQuestionScore(true, -1000);
      expect(result.elapsedMs).toBe(0);
    });

    it("clamps elapsed time to max limit", () => {
      const result = calculateQuestionScore(true, 20000);
      expect(result.elapsedMs).toBe(QUESTION_TIME_LIMIT_MS);
    });

    it("handles exact boundary values", () => {
      const atLimit = calculateQuestionScore(true, QUESTION_TIME_LIMIT_MS);
      expect(atLimit.elapsedMs).toBe(QUESTION_TIME_LIMIT_MS);
      expect(atLimit.bonusPoints).toBe(0);
    });
  });
});

describe("validateTotalScore", () => {
  it("accepts valid scores", () => {
    expect(validateTotalScore(0)).toBe(true);
    expect(validateTotalScore(50)).toBe(true);
    expect(validateTotalScore(100)).toBe(true);
    expect(validateTotalScore(MAX_QUESTIONS_PER_QUIZ * MAX_SCORE_PER_QUESTION)).toBe(true);
  });

  it("rejects negative scores", () => {
    expect(validateTotalScore(-1)).toBe(false);
  });

  it("rejects scores above max", () => {
    const maxScore = MAX_QUESTIONS_PER_QUIZ * MAX_SCORE_PER_QUESTION;
    expect(validateTotalScore(maxScore + 1)).toBe(false);
  });
});

