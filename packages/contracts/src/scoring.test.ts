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
  it("returns max bonus (5) at 0ms", () => {
    const bonus = calculateBonus(0);
    expect(bonus).toBe(5);
  });

  it("returns 5 bonus in 0-2s tier", () => {
    expect(calculateBonus(0)).toBe(5);
    expect(calculateBonus(1000)).toBe(5); // 1 second
    expect(calculateBonus(1999)).toBe(5); // Just under 2 seconds
  });

  it("returns 4 bonus in 2-4s tier", () => {
    expect(calculateBonus(2000)).toBe(4); // Exactly 2 seconds
    expect(calculateBonus(3000)).toBe(4); // 3 seconds
    expect(calculateBonus(3999)).toBe(4); // Just under 4 seconds
  });

  it("returns 3 bonus in 4-6s tier", () => {
    expect(calculateBonus(4000)).toBe(3); // Exactly 4 seconds
    expect(calculateBonus(5000)).toBe(3); // 5 seconds
    expect(calculateBonus(5999)).toBe(3); // Just under 6 seconds
  });

  it("returns 2 bonus in 6-8s tier", () => {
    expect(calculateBonus(6000)).toBe(2); // Exactly 6 seconds
    expect(calculateBonus(7000)).toBe(2); // 7 seconds
    expect(calculateBonus(7999)).toBe(2); // Just under 8 seconds
  });

  it("returns 1 bonus in 8-10s tier", () => {
    expect(calculateBonus(8000)).toBe(1); // Exactly 8 seconds
    expect(calculateBonus(9000)).toBe(1); // 9 seconds
    expect(calculateBonus(9999)).toBe(1); // Just under 10 seconds
  });

  it("returns 0 bonus at 10s (bonus window end)", () => {
    const bonus = calculateBonus(BONUS_WINDOW_MS);
    expect(bonus).toBe(0);
  });

  it("returns 0 bonus after 10s", () => {
    const bonus = calculateBonus(BONUS_WINDOW_MS + 1000);
    expect(bonus).toBe(0);
  });

  it("clamps negative values to max bonus", () => {
    const bonus = calculateBonus(-1000);
    expect(bonus).toBe(5);
  });

  it("clamps values above bonus window to 0", () => {
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

    it("calculates score at 5s (3 bonus in 4-6s tier)", () => {
      const result = calculateQuestionScore(true, 5000);
      expect(result.basePoints).toBe(BASE_POINTS_CORRECT);
      expect(result.bonusPoints).toBe(3);
      expect(result.totalPoints).toBe(8);
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

