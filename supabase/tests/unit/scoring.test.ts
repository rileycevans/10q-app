import { describe, expect, it } from "vitest";
import {
  BONUS_WINDOW_MS,
  QUESTION_TIME_LIMIT_MS,
  calculateBonus,
  calculateQuestionScore,
  computeElapsed,
} from "../../functions/_shared/scoring.ts";

describe("calculateBonus", () => {
  it("awards 5 for sub-3s answers", () => {
    expect(calculateBonus(0)).toBe(5);
    expect(calculateBonus(1_500)).toBe(5);
    expect(calculateBonus(2_999)).toBe(5);
  });

  it("awards 4 in [3s, 5s)", () => {
    expect(calculateBonus(3_000)).toBe(4);
    expect(calculateBonus(4_999)).toBe(4);
  });

  it("awards 3 in [5s, 7s)", () => {
    expect(calculateBonus(5_000)).toBe(3);
    expect(calculateBonus(6_999)).toBe(3);
  });

  it("awards 2 in [7s, 9s)", () => {
    expect(calculateBonus(7_000)).toBe(2);
    expect(calculateBonus(8_999)).toBe(2);
  });

  it("awards 1 in [9s, 11s)", () => {
    expect(calculateBonus(9_000)).toBe(1);
    expect(calculateBonus(10_999)).toBe(1);
  });

  it("awards 0 at and beyond 11s", () => {
    expect(calculateBonus(11_000)).toBe(0);
    expect(calculateBonus(11_500)).toBe(0);
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

  it("gives 5 base + 0 bonus when correct but over 11s", () => {
    const score = calculateQuestionScore(true, 11_500, false);
    expect(score.basePoints).toBe(5);
    expect(score.bonusPoints).toBe(0);
    expect(score.totalPoints).toBe(5);
    expect(score.elapsedMs).toBe(11_500);
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

/**
 * C2 — a timed-out question could be scored as a deliberate correct answer.
 *
 * The client's countdown and the server's window do not start together: the
 * server stamps its start one round-trip after the UI begins counting. So a
 * genuine client timeout can arrive with server elapsed still under the limit.
 * Because submit-answer hard-required a non-null selected_answer_id, the client
 * substituted answers[0] — and with server elapsed under the limit, that was
 * recorded as a real selection, scoring 5 base points whenever answer A
 * happened to be correct.
 *
 * The fix is an explicit is_timeout flag. These assert the scoring half of it:
 * once anything marks the answer a timeout, it is worth zero regardless of
 * correctness.
 */
describe("calculateQuestionScore — timeout precedence (C2)", () => {
  it("scores zero for a timeout even when the answer was correct", () => {
    const score = calculateQuestionScore(true, 3_000, true);
    expect(score.totalPoints).toBe(0);
    expect(score.basePoints).toBe(0);
    expect(score.bonusPoints).toBe(0);
  });

  it("scores zero for a timeout that arrives FAST on the server clock", () => {
    // The exact C2 shape: the client timed out, but the server's window began
    // later so its elapsed is only 3s. Without the flag this scored points.
    const score = calculateQuestionScore(true, 3_000, true);
    expect(score.totalPoints).toBe(0);
  });

  it("records a timeout at the full time limit, not the elapsed value", () => {
    // Keeps timeouts indistinguishable from one another in the data, and keeps
    // time_ms inside the CHECK tightened in the C1 migration.
    const score = calculateQuestionScore(false, 500, true);
    expect(score.elapsedMs).toBe(12_000);
  });

  it("still scores a genuine fast correct answer", () => {
    const score = calculateQuestionScore(true, 3_000, false);
    expect(score.totalPoints).toBeGreaterThan(0);
    expect(score.basePoints).toBe(5);
  });
});
