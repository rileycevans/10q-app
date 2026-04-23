import { describe, expect, it } from "vitest";
import {
  classifyAttempt,
  computeNextQuestionTimings,
  isUniqueViolation,
  MAX_QUESTIONS_PER_QUIZ,
  planQuestionTimerStart,
  validateFinalize,
  validateSubmitAnswer,
} from "../../functions/_shared/attempt-state.ts";

const baseAttempt = {
  id: "attempt-1",
  player_id: "player-1",
  quiz_id: "quiz-1",
  current_index: 3,
  finalized_at: null,
  current_question_started_at: "2026-04-20T12:00:00.000Z",
};

const matchingQuestion = {
  question_id: "q-3",
  quiz_id: "quiz-1",
  order_index: 3,
};

describe("validateSubmitAnswer", () => {
  it("returns ok when the attempt is live and the question is current", () => {
    expect(validateSubmitAnswer(baseAttempt, matchingQuestion)).toEqual({
      ok: true,
    });
  });

  it("rejects when the attempt is already finalized", () => {
    const finalized = { ...baseAttempt, finalized_at: "2026-04-20T12:01:00.000Z" };
    const result = validateSubmitAnswer(finalized, matchingQuestion);
    expect(result).toEqual({
      ok: false,
      code: "ATTEMPT_ALREADY_COMPLETED",
      message: expect.stringMatching(/completed/i),
      status: 400,
    });
  });

  it("rejects when the question belongs to a different quiz", () => {
    const wrongQuiz = { ...matchingQuestion, quiz_id: "quiz-other" };
    const result = validateSubmitAnswer(baseAttempt, wrongQuiz);
    expect(result).toEqual({
      ok: false,
      code: "QUESTION_NOT_FOUND",
      message: expect.any(String),
      status: 404,
    });
  });

  it("rejects when the question is not the current index (skipping ahead)", () => {
    const skipAhead = { ...matchingQuestion, order_index: 5 };
    const result = validateSubmitAnswer(baseAttempt, skipAhead);
    expect(result).toEqual({
      ok: false,
      code: "INVALID_STATE_TRANSITION",
      message: expect.any(String),
      status: 400,
    });
  });

  it("rejects when the user tries to re-answer a previous question", () => {
    const past = { ...matchingQuestion, order_index: 1 };
    const result = validateSubmitAnswer(baseAttempt, past);
    expect(result).toEqual({
      ok: false,
      code: "INVALID_STATE_TRANSITION",
      message: expect.any(String),
      status: 400,
    });
  });

  it("prioritizes finalized check over quiz/question checks", () => {
    const finalized = { ...baseAttempt, finalized_at: "2026-04-20T12:01:00.000Z" };
    const wrong = { ...matchingQuestion, quiz_id: "other", order_index: 99 };
    const result = validateSubmitAnswer(finalized, wrong);
    expect(result).toEqual({
      ok: false,
      code: "ATTEMPT_ALREADY_COMPLETED",
      message: expect.any(String),
      status: 400,
    });
  });
});

describe("computeNextQuestionTimings", () => {
  const now = Date.UTC(2026, 3, 20, 12, 0, 0);
  const TIME_LIMIT_MS = 12_000;

  it("computes start + expiry for the next question when one remains", () => {
    const r = computeNextQuestionTimings(1, now, TIME_LIMIT_MS);
    expect(r.nextIndex).toBe(2);
    expect(r.questionStartedAt).toBe(new Date(now).toISOString());
    expect(r.questionExpiresAt).toBe(new Date(now + TIME_LIMIT_MS).toISOString());
  });

  it("returns null timings after the last question is answered", () => {
    const r = computeNextQuestionTimings(
      MAX_QUESTIONS_PER_QUIZ,
      now,
      TIME_LIMIT_MS,
    );
    expect(r.nextIndex).toBe(MAX_QUESTIONS_PER_QUIZ + 1);
    expect(r.questionStartedAt).toBeNull();
    expect(r.questionExpiresAt).toBeNull();
  });
});

describe("validateFinalize", () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({
    question_id: `q-${i + 1}`,
    order_index: i + 1,
  }));

  it("ok when all 10 questions are answered", () => {
    const answered = questions.map((q) => q.question_id);
    expect(validateFinalize(answered, questions)).toEqual({ ok: true });
  });

  it("ok when extra answers exist (belt-and-braces)", () => {
    const answered = questions.map((q) => q.question_id).concat(["phantom"]);
    expect(validateFinalize(answered, questions)).toEqual({ ok: true });
  });

  it("reports missing indices, sorted ascending, when incomplete", () => {
    const answered = ["q-1", "q-2", "q-4", "q-5", "q-7"];
    const result = validateFinalize(answered, questions);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.status).toBe(400);
    expect(result.missingIndices).toEqual([3, 6, 8, 9, 10]);
    expect(result.message).toContain("3, 6, 8, 9, 10");
    expect(result.message).toContain("5/10");
  });

  it("falls back to a message without indices when quiz_questions lookup failed", () => {
    const result = validateFinalize(["q-1", "q-2"], []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingIndices).toEqual([]);
    expect(result.message).toContain("2/10");
    expect(result.message).not.toContain("Missing questions");
  });
});

describe("classifyAttempt", () => {
  it("returns FINALIZED when finalized_at is set", () => {
    expect(
      classifyAttempt({
        finalized_at: "2026-04-20T12:00:00.000Z",
        current_index: 5,
      }),
    ).toBe("FINALIZED");
  });

  it("returns FINALIZED even if current_index is still mid-quiz", () => {
    expect(
      classifyAttempt({ finalized_at: "2026-04-20T12:00:00.000Z", current_index: 3 }),
    ).toBe("FINALIZED");
  });

  it("returns READY_TO_FINALIZE when all 10 answered but not finalized", () => {
    expect(
      classifyAttempt({ finalized_at: null, current_index: 11 }),
    ).toBe("READY_TO_FINALIZE");
  });

  it("returns IN_PROGRESS on the first question", () => {
    expect(classifyAttempt({ finalized_at: null, current_index: 1 })).toBe(
      "IN_PROGRESS",
    );
  });

  it("returns IN_PROGRESS on the last question (index 10)", () => {
    expect(
      classifyAttempt({ finalized_at: null, current_index: MAX_QUESTIONS_PER_QUIZ }),
    ).toBe("IN_PROGRESS");
  });
});

describe("planQuestionTimerStart", () => {
  const TIME_LIMIT_MS = 12_000;
  const now = Date.UTC(2026, 3, 20, 12, 0, 0);

  it("returns error when the attempt is already finalized", () => {
    const plan = planQuestionTimerStart(
      {
        finalized_at: "2026-04-20T11:00:00.000Z",
        current_question_started_at: null,
        current_question_expires_at: null,
      },
      now,
      TIME_LIMIT_MS,
    );
    expect(plan).toEqual({
      action: "error",
      code: "ATTEMPT_ALREADY_COMPLETED",
      message: expect.any(String),
      status: 400,
    });
  });

  it("returns noop with the existing timer values when already started (idempotent)", () => {
    const plan = planQuestionTimerStart(
      {
        finalized_at: null,
        current_question_started_at: "2026-04-20T11:59:50.000Z",
        current_question_expires_at: "2026-04-20T12:00:02.000Z",
      },
      now,
      TIME_LIMIT_MS,
    );
    expect(plan).toEqual({
      action: "noop",
      questionStartedAt: "2026-04-20T11:59:50.000Z",
      questionExpiresAt: "2026-04-20T12:00:02.000Z",
    });
  });

  it("returns start with fresh ISO timestamps when no timer is set", () => {
    const plan = planQuestionTimerStart(
      {
        finalized_at: null,
        current_question_started_at: null,
        current_question_expires_at: null,
      },
      now,
      TIME_LIMIT_MS,
    );
    expect(plan).toEqual({
      action: "start",
      questionStartedAt: new Date(now).toISOString(),
      questionExpiresAt: new Date(now + TIME_LIMIT_MS).toISOString(),
    });
  });

  it("prioritizes finalized over already-started", () => {
    const plan = planQuestionTimerStart(
      {
        finalized_at: "2026-04-20T11:00:00.000Z",
        current_question_started_at: "2026-04-20T10:59:50.000Z",
        current_question_expires_at: "2026-04-20T11:00:02.000Z",
      },
      now,
      TIME_LIMIT_MS,
    );
    expect(plan.action).toBe("error");
  });
});

describe("isUniqueViolation", () => {
  it("recognizes Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("returns false for other codes", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation({ code: "PGRST116" })).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("returns false when the error has no code", () => {
    expect(isUniqueViolation({})).toBe(false);
  });
});
