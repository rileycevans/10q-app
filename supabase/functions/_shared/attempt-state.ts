/**
 * Pure validators for attempt state transitions.
 * Keeping these out of the HTTP handlers makes them unit-testable.
 */

/**
 * Error-code string literals used by these validators. Duplicated from
 * `./response.ts` to keep this module free of Deno-only imports (cors.ts
 * reads `Deno.env`), so it can be unit-tested from Node.
 */
type ErrorCode =
  | "ATTEMPT_ALREADY_COMPLETED"
  | "QUESTION_NOT_FOUND"
  | "INVALID_STATE_TRANSITION"
  | "VALIDATION_ERROR";

const ErrorCodes = {
  ATTEMPT_ALREADY_COMPLETED: "ATTEMPT_ALREADY_COMPLETED",
  QUESTION_NOT_FOUND: "QUESTION_NOT_FOUND",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;

export const MAX_QUESTIONS_PER_QUIZ = 10;

export type AttemptState = "FINALIZED" | "READY_TO_FINALIZE" | "IN_PROGRESS";

/**
 * Classify a resumed attempt into the state the client needs to drive the UI.
 *
 * - FINALIZED: attempt has a finalized_at timestamp.
 * - READY_TO_FINALIZE: all 10 questions answered but not yet finalized.
 * - IN_PROGRESS: still a current question to play.
 */
export function classifyAttempt(attempt: {
  finalized_at: string | null;
  current_index: number;
}): AttemptState {
  if (attempt.finalized_at) return "FINALIZED";
  if (attempt.current_index > MAX_QUESTIONS_PER_QUIZ) return "READY_TO_FINALIZE";
  return "IN_PROGRESS";
}

/**
 * A Postgres unique-constraint violation. Used by edge functions to detect
 * a race on idempotent inserts (two requests creating the same
 * (player_id, quiz_id) attempt, or the same (attempt_id, question_id) answer).
 */
export const UNIQUE_VIOLATION_CODE = "23505";

export function isUniqueViolation(
  error: { code?: string } | null | undefined,
): boolean {
  return !!error && error.code === UNIQUE_VIOLATION_CODE;
}

/**
 * Decide whether start-question-timer should issue a fresh start or
 * return the existing timer values (idempotent).
 */
export function planQuestionTimerStart(
  attempt: {
    finalized_at: string | null;
    current_question_started_at: string | null;
    current_question_expires_at: string | null;
  },
  nowMs: number,
  questionTimeLimitMs: number,
):
  | { action: "error"; code: ErrorCode; message: string; status: number }
  | {
      action: "noop";
      questionStartedAt: string;
      questionExpiresAt: string | null;
    }
  | { action: "start"; questionStartedAt: string; questionExpiresAt: string } {
  if (attempt.finalized_at) {
    return {
      action: "error",
      code: ErrorCodes.ATTEMPT_ALREADY_COMPLETED,
      message: "Attempt has already been completed",
      status: 400,
    };
  }

  if (attempt.current_question_started_at) {
    return {
      action: "noop",
      questionStartedAt: attempt.current_question_started_at,
      questionExpiresAt: attempt.current_question_expires_at,
    };
  }

  const start = new Date(nowMs).toISOString();
  const expires = new Date(nowMs + questionTimeLimitMs).toISOString();
  return { action: "start", questionStartedAt: start, questionExpiresAt: expires };
}

export interface AttemptLike {
  id: string;
  player_id: string;
  quiz_id: string;
  current_index: number;
  finalized_at: string | null;
  current_question_started_at: string | null;
}

export interface QuizQuestionLike {
  question_id: string;
  quiz_id: string;
  order_index: number;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: ErrorCode; message: string; status: number };

/**
 * Gate to the submit-answer mutation.
 * Checks: attempt not finalized; question belongs to the quiz; question is current.
 */
export function validateSubmitAnswer(
  attempt: AttemptLike,
  quizQuestion: QuizQuestionLike,
): ValidationResult {
  if (attempt.finalized_at) {
    return {
      ok: false,
      code: ErrorCodes.ATTEMPT_ALREADY_COMPLETED,
      message: "Attempt has already been completed",
      status: 400,
    };
  }

  if (quizQuestion.quiz_id !== attempt.quiz_id) {
    return {
      ok: false,
      code: ErrorCodes.QUESTION_NOT_FOUND,
      message: "Question not found in quiz",
      status: 404,
    };
  }

  if (quizQuestion.order_index !== attempt.current_index) {
    return {
      ok: false,
      code: ErrorCodes.INVALID_STATE_TRANSITION,
      message: "Question is not the current question",
      status: 400,
    };
  }

  return { ok: true };
}

/**
 * After an answer is accepted, compute the next-question metadata.
 * Returns nulls once the attempt is past the last question, signalling the
 * client should call finalize-attempt next.
 */
export interface NextQuestionTimings {
  nextIndex: number;
  questionStartedAt: string | null;
  questionExpiresAt: string | null;
}

export function computeNextQuestionTimings(
  currentIndex: number,
  nowMs: number,
  questionTimeLimitMs: number,
): NextQuestionTimings {
  const nextIndex = currentIndex + 1;
  const hasNext = nextIndex <= MAX_QUESTIONS_PER_QUIZ;
  return {
    nextIndex,
    questionStartedAt: hasNext ? new Date(nowMs).toISOString() : null,
    questionExpiresAt: hasNext
      ? new Date(nowMs + questionTimeLimitMs).toISOString()
      : null,
  };
}

/**
 * Gate to finalize-attempt.
 * Checks that all 10 answers are present and returns missing indices otherwise.
 */
export function validateFinalize(
  answerQuestionIds: string[],
  allQuizQuestions: Array<{ question_id: string; order_index: number }>,
):
  | { ok: true; correctCount?: number }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      status: number;
      missingIndices: number[];
    } {
  if (answerQuestionIds.length >= MAX_QUESTIONS_PER_QUIZ) {
    return { ok: true };
  }

  const answered = new Set(answerQuestionIds);
  const missingIndices = allQuizQuestions
    .filter((q) => !answered.has(q.question_id))
    .map((q) => q.order_index)
    .sort((a, b) => a - b);

  const message = missingIndices.length > 0
    ? `Attempt incomplete: ${answerQuestionIds.length}/${MAX_QUESTIONS_PER_QUIZ} questions answered. Missing questions: ${missingIndices.join(", ")}`
    : `Attempt incomplete: ${answerQuestionIds.length}/${MAX_QUESTIONS_PER_QUIZ} questions answered`;

  return {
    ok: false,
    code: ErrorCodes.VALIDATION_ERROR,
    message,
    status: 400,
    missingIndices,
  };
}
