import { describe, expect, it } from "vitest";
import {
  BONUS_WINDOW_MS,
  QUESTION_TIME_LIMIT_MS,
  calculateBonus,
  calculateQuestionScore,
  computeElapsed,
} from "../../functions/_shared/scoring.ts";

describe("calculateBonus", () => {
  it("awards 5 for sub-1.5s answers", () => {
    expect(calculateBonus(0)).toBe(5);
    expect(calculateBonus(500)).toBe(5);
    expect(calculateBonus(1499)).toBe(5);
  });

  it("awards 4 in [1.5s, 3s)", () => {
    expect(calculateBonus(1500)).toBe(4);
    expect(calculateBonus(2999)).toBe(4);
  });

  it("awards 3 in [3s, 4.5s)", () => {
    expect(calculateBonus(3000)).toBe(3);
    expect(calculateBonus(4499)).toBe(3);
  });

  it("awards 2 in [4.5s, 6s)", () => {
    expect(calculateBonus(4500)).toBe(2);
    expect(calculateBonus(5999)).toBe(2);
  });

  it("awards 1 in [6s, 7.5s)", () => {
    expect(calculateBonus(6000)).toBe(1);
    expect(calculateBonus(7499)).toBe(1);
  });

  it("awards 0 at and beyond 7.5s", () => {
    expect(calculateBonus(7500)).toBe(0);
    expect(calculateBonus(10_000)).toBe(0);
    expect(calculateBonus(QUESTION_TIME_LIMIT_MS)).toBe(0);
  });

  it("clamps negative input to 0 (= max bonus)", () => {
    expect(calculateBonus(-1000)).toBe(5);
  });

  it("clamps above-window input to BONUS_WINDOW_MS (= 0 bonus)", () => {
    expect(calculateBonus(BONUS_WINDOW_MS + 10_000)).toBe(0);
  });
});

describe("calculateQuestionScore", () => {
  it("gives 0 on timeout regardless of correctness and sets elapsed to time-limit", () => {
    const score = calculateQuestionScore(true, 5_000, true);
    expect(score).toEqual({
      basePoints: 0,
      bonusPoints: 0,
      totalPoints: 0,
      elapsedMs: QUESTION_TIME_LIMIT_MS,
    });
  });

  it("gives 0 for an incorrect non-timeout answer (no bonus either)", () => {
    const score = calculateQuestionScore(false, 1_000, false);
    expect(score).toEqual({
      basePoints: 0,
      bonusPoints: 0,
      totalPoints: 0,
      elapsedMs: 1_000,
    });
  });

  it("gives 5 base + tiered bonus for a correct non-timeout answer", () => {
    const score = calculateQuestionScore(true, 1_000, false);
    expect(score).toEqual({
      basePoints: 5,
      bonusPoints: 5,
      totalPoints: 10,
      elapsedMs: 1_000,
    });
  });

  it("gives 5 base + 0 bonus when correct but over 7.5s", () => {
    const score = calculateQuestionScore(true, 9_000, false);
    expect(score.basePoints).toBe(5);
    expect(score.bonusPoints).toBe(0);
    expect(score.totalPoints).toBe(5);
    expect(score.elapsedMs).toBe(9_000);
  });

  it("clamps elapsedMs to [0, QUESTION_TIME_LIMIT_MS]", () => {
    expect(calculateQuestionScore(true, -500, false).elapsedMs).toBe(0);
    expect(calculateQuestionScore(true, 99_999, false).elapsedMs).toBe(
      QUESTION_TIME_LIMIT_MS,
    );
  });
});

describe("computeElapsed", () => {
  it("returns positive elapsed and isTimeout=false within the window", () => {
    const started = "2026-04-20T12:00:00.000Z";
    const now = new Date("2026-04-20T12:00:03.000Z").getTime();
    expect(computeElapsed(started, now)).toEqual({
      elapsedMs: 3_000,
      isTimeout: false,
    });
  });

  it("flags timeout exactly at QUESTION_TIME_LIMIT_MS", () => {
    const started = "2026-04-20T12:00:00.000Z";
    const now = new Date("2026-04-20T12:00:12.000Z").getTime();
    expect(computeElapsed(started, now)).toEqual({
      elapsedMs: QUESTION_TIME_LIMIT_MS,
      isTimeout: true,
    });
  });

  it("treats a negative client-server clock skew as 0 elapsed", () => {
    const started = "2026-04-20T12:00:05.000Z";
    const now = new Date("2026-04-20T12:00:00.000Z").getTime();
    expect(computeElapsed(started, now)).toEqual({
      elapsedMs: 0,
      isTimeout: false,
    });
  });
});
