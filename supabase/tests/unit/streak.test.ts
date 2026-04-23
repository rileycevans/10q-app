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
