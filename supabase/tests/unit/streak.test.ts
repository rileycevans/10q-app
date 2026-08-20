import { describe, expect, it } from "vitest";
import {
  computeStreak,
  previousDayUtc,
  toUtcDateString,
} from "../../functions/_shared/streak.ts";

describe("previousDayUtc", () => {
  it("subtracts one day", () => {
    expect(previousDayUtc("2026-04-20")).toBe("2026-04-19");
  });

  it("handles month boundary", () => {
    expect(previousDayUtc("2026-05-01")).toBe("2026-04-30");
  });

  it("handles year boundary", () => {
    expect(previousDayUtc("2026-01-01")).toBe("2025-12-31");
  });

  it("handles leap-year Feb boundary", () => {
    expect(previousDayUtc("2024-03-01")).toBe("2024-02-29");
    expect(previousDayUtc("2023-03-01")).toBe("2023-02-28");
  });

  it("ignores a time component if passed a full ISO string", () => {
    expect(previousDayUtc("2026-04-20T23:59:59.999Z")).toBe("2026-04-19");
  });
});

describe("toUtcDateString", () => {
  it("extracts the UTC date from an ISO timestamp", () => {
    expect(toUtcDateString("2026-04-20T23:59:59.999Z")).toBe("2026-04-20");
  });

  it("uses UTC even when the local tz would roll to next day", () => {
    // 23:30 UTC is still 2026-04-20 regardless of local tz.
    expect(toUtcDateString("2026-04-20T23:30:00.000Z")).toBe("2026-04-20");
  });
});

describe("computeStreak", () => {
  it("starts at 1 when the player has never completed a quiz", () => {
    expect(
      computeStreak({
        quizDate: "2026-04-20",
        lastQuizDate: null,
        previousCurrentStreak: 0,
        previousLongestStreak: 0,
      }),
    ).toEqual({ currentStreak: 1, longestStreak: 1 });
  });

  it("does not bump current streak on same-day retake", () => {
    expect(
      computeStreak({
        quizDate: "2026-04-20",
        lastQuizDate: "2026-04-20",
        previousCurrentStreak: 5,
        previousLongestStreak: 5,
      }),
    ).toEqual({ currentStreak: 5, longestStreak: 5 });
  });

  it("bumps current streak by 1 when last quiz was exactly yesterday (UTC)", () => {
    expect(
      computeStreak({
        quizDate: "2026-04-20",
        lastQuizDate: "2026-04-19",
        previousCurrentStreak: 5,
        previousLongestStreak: 5,
      }),
    ).toEqual({ currentStreak: 6, longestStreak: 6 });
  });

  it("bumps longestStreak when currentStreak exceeds prior record", () => {
    expect(
      computeStreak({
        quizDate: "2026-04-20",
        lastQuizDate: "2026-04-19",
        previousCurrentStreak: 9,
        previousLongestStreak: 9,
      }),
    ).toEqual({ currentStreak: 10, longestStreak: 10 });
  });

  it("keeps longestStreak when currentStreak is lower", () => {
    expect(
      computeStreak({
        quizDate: "2026-04-20",
        lastQuizDate: null,
        previousCurrentStreak: 0,
        previousLongestStreak: 50,
      }),
    ).toEqual({ currentStreak: 1, longestStreak: 50 });
  });

  it("resets to 1 when there is a gap of more than one day", () => {
    expect(
      computeStreak({
        quizDate: "2026-04-20",
        lastQuizDate: "2026-04-18",
        previousCurrentStreak: 7,
        previousLongestStreak: 7,
      }),
    ).toEqual({ currentStreak: 1, longestStreak: 7 });
  });

  it("resets to 1 when the last quiz date is in the future (data corruption guard)", () => {
    expect(
      computeStreak({
        quizDate: "2026-04-20",
        lastQuizDate: "2026-04-21",
        previousCurrentStreak: 7,
        previousLongestStreak: 7,
      }),
    ).toEqual({ currentStreak: 1, longestStreak: 7 });
  });

  it("handles month-boundary yesterday correctly", () => {
    expect(
      computeStreak({
        quizDate: "2026-05-01",
        lastQuizDate: "2026-04-30",
        previousCurrentStreak: 3,
        previousLongestStreak: 3,
      }),
    ).toEqual({ currentStreak: 4, longestStreak: 4 });
  });

  it("handles year-boundary yesterday correctly", () => {
    expect(
      computeStreak({
        quizDate: "2026-01-01",
        lastQuizDate: "2025-12-31",
        previousCurrentStreak: 100,
        previousLongestStreak: 100,
      }),
    ).toEqual({ currentStreak: 101, longestStreak: 101 });
  });
});

/**
 * C7 — streaks never expired.
 *
 * computeStreak only runs at finalize, so players.current_streak is the value
 * as of the last time someone played, not as of today. Measured before the
 * fix: 132 of 133 non-zero streaks were already dead by the game's own rule,
 * and the home screen was reading that column directly — so those players were
 * shown a streak they no longer had. One had last played four months earlier.
 *
 * The fix derives liveness instead of storing it (public.is_streak_alive and
 * the player_streaks view). These assert the rule the SQL implements; the
 * boundary is the part worth pinning, since "yesterday still counts" is a
 * deliberate product choice, not an off-by-one.
 */
describe("streak expiry rule (C7)", () => {
  // Mirrors public.is_streak_alive(). Kept in the test rather than shipped
  // twice: the SQL is the enforcement point, this is the specification.
  function isStreakAlive(lastQuizDate: string | null, today: string): boolean {
    if (!lastQuizDate) return false;
    const last = Date.parse(`${lastQuizDate}T00:00:00.000Z`);
    const now = Date.parse(`${today}T00:00:00.000Z`);
    return Math.round((now - last) / 86_400_000) <= 1;
  }

  const TODAY = "2026-08-19";

  it("today counts as alive", () => {
    expect(isStreakAlive("2026-08-19", TODAY)).toBe(true);
  });

  it("yesterday still counts — today's quiz may not have dropped for them yet", () => {
    expect(isStreakAlive("2026-08-18", TODAY)).toBe(true);
  });

  it("two days ago is dead", () => {
    expect(isStreakAlive("2026-08-17", TODAY)).toBe(false);
  });

  it("months ago is dead — the real case in production", () => {
    // A player whose last_quiz_date was 2026-04-21 was reading a 15-day streak.
    expect(isStreakAlive("2026-04-21", TODAY)).toBe(false);
  });

  it("never having played is not a live streak", () => {
    expect(isStreakAlive(null, TODAY)).toBe(false);
  });

  it("handles a month boundary", () => {
    expect(isStreakAlive("2026-07-31", "2026-08-01")).toBe(true);
    expect(isStreakAlive("2026-07-30", "2026-08-01")).toBe(false);
  });

  it("handles a year boundary", () => {
    expect(isStreakAlive("2025-12-31", "2026-01-01")).toBe(true);
    expect(isStreakAlive("2025-12-30", "2026-01-01")).toBe(false);
  });
});
