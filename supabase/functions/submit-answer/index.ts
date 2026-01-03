/**
 * Submit Answer Edge Function
 * Server-authoritative timing and scoring
 * Idempotent on (attempt_id, question_id)
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";

// Scoring constants (mirrored from contracts for Deno compatibility)
const BASE_POINTS_CORRECT = 5;
const BASE_POINTS_INCORRECT = 0;
const MAX_BONUS_POINTS = 5;
const BONUS_WINDOW_MS = 10000;
const QUESTION_TIME_LIMIT_MS = 16000;

/**
 * Calculate bonus points (linear from 0-10s, 0 after 10s)
 * Rounded to nearest 0.5
 */
function calculateBonus(elapsedMs: number): number {
  const clamped = Math.min(Math.max(elapsedMs, 0), BONUS_WINDOW_MS);
  const bonus = MAX_BONUS_POINTS * (1 - clamped / BONUS_WINDOW_MS);
  return Math.round(bonus * 2) / 2;
}

/**
 * Calculate question score
 */
function calculateQuestionScore(
  isCorrect: boolean,
  elapsedMs: number,
  isTimeout: boolean
): {
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  elapsedMs: number;
} {
  const clampedElapsedMs = Math.min(
    Math.max(elapsedMs, 0),
    QUESTION_TIME_LIMIT_MS
  );

  if (isTimeout) {
    return {
      basePoints: BASE_POINTS_INCORRECT,
      bonusPoints: 0,
      totalPoints: 0,
      elapsedMs: QUESTION_TIME_LIMIT_MS,
    };
  }

  const basePoints = isCorrect ? BASE_POINTS_CORRECT : BASE_POINTS_INCORRECT;
  const bonusPoints = isCorrect ? calculateBonus(clampedElapsedMs) : 0;

  return {
    basePoints,
    bonusPoints,
    totalPoints: basePoints + bonusPoints,
    elapsedMs: clampedElapsedMs,
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse(
      ErrorCodes.VALIDATION_ERROR,
      "Method not allowed",
      generateRequestId(),
      405
    );
  }

  const requestId = generateRequestId();
  logStructured(requestId, "submit_answer_request", {});

  try {
    // Authenticate user
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    // Parse request body
    const body = await req.json();
    const { attempt_id, question_id, selected_choice_id } = body;

    if (!attempt_id || !question_id || !selected_choice_id) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "attempt_id, question_id, and selected_choice_id are required",
        requestId,
        400
      );
    }

    const supabase = createServiceClient();

    // Fetch attempt and verify ownership
    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("*")
      .eq("id", attempt_id)
      .eq("player_id", userId)
      .single();

    if (attemptError || !attempt) {
      return errorResponse(
        ErrorCodes.ATTEMPT_NOT_FOUND,
        "Attempt not found",
        requestId,
        404
      );
    }

    // Check if attempt is finalized
    if (attempt.finalized_at) {
      return errorResponse(
        ErrorCodes.ATTEMPT_ALREADY_COMPLETED,
        "Attempt has already been completed",
        requestId,
        400
      );
    }

    // Verify question is current question
    const { data: question, error: questionError } = await supabase
      .from("questions")
      .select("id, quiz_id, order_index")
      .eq("id", question_id)
      .single();

    if (questionError || !question) {
      return errorResponse(
        ErrorCodes.QUESTION_NOT_FOUND,
        "Question not found",
        requestId,
        404
      );
    }

    if (question.order_index !== attempt.current_index) {
      return errorResponse(
        ErrorCodes.INVALID_STATE_TRANSITION,
        "Question is not the current question",
        requestId,
        400
      );
    }

    // Check if answer already submitted (idempotency)
    const { data: existingAnswer } = await supabase
      .from("attempt_answers")
      .select("*")
      .eq("attempt_id", attempt_id)
      .eq("question_id", question_id)
      .single();

    if (existingAnswer) {
      // Already answered - return existing result (idempotent)
      logStructured(requestId, "submit_answer_idempotent", {
        attempt_id,
        question_id,
      });

      // Get next question if available
      const nextIndex = attempt.current_index + 1;
      const { data: nextQuestions } = await supabase
        .from("quiz_play_view")
        .select("*")
        .eq("quiz_id", attempt.quiz_id)
        .eq("order_index", nextIndex);

      return successResponse(
        {
          attempt_id,
          question_id,
          answer_id: existingAnswer.id,
          is_correct: existingAnswer.is_correct,
          base_points: existingAnswer.base_points,
          bonus_points: existingAnswer.bonus_points,
          total_points: existingAnswer.base_points + existingAnswer.bonus_points,
          time_ms: existingAnswer.time_ms,
          next_question: nextQuestions?.[0] || null,
          current_index: attempt.current_index,
        },
        requestId
      );
    }

    // Server-authoritative timing calculation
    const now = new Date();
    const questionStartedAt = new Date(attempt.current_question_started_at);
    const elapsedMs = Math.max(0, now.getTime() - questionStartedAt.getTime());

    // Check if question expired
    const isExpired = elapsedMs >= QUESTION_TIME_LIMIT_MS;
    const isTimeout = isExpired;

    // Get correct answer from private schema (service role can access)
    const { data: correct, error: correctError } = await supabase
      .from("private.correct_answers")
      .select("correct_choice_id")
      .eq("question_id", question_id)
      .single();

    if (correctError || !correct) {
      logStructured(requestId, "submit_answer_correct_not_found", {
        question_id,
        error: correctError?.message,
      });
      return errorResponse(
        ErrorCodes.QUESTION_NOT_FOUND,
        "Correct answer not found",
        requestId,
        404
      );
    }

    const correctChoiceId = correct.correct_choice_id;

    if (!correctChoiceId) {
      logStructured(requestId, "submit_answer_correct_not_found", {
        question_id,
      });
      return errorResponse(
        ErrorCodes.QUESTION_NOT_FOUND,
        "Correct answer not found",
        requestId,
        404
      );
    }

    // Determine if answer is correct
    const isCorrect = !isTimeout && selected_choice_id === correctChoiceId;

    // Calculate score
    const score = calculateQuestionScore(isCorrect, elapsedMs, isTimeout);

    // Insert answer (idempotent via PRIMARY KEY constraint)
    const { data: answer, error: answerError } = await supabase
      .from("attempt_answers")
      .insert({
        attempt_id,
        question_id,
        answer_kind: isTimeout ? "timeout" : "selected",
        selected_answer_id: isTimeout ? null : selected_choice_id,
        is_correct: isCorrect,
        time_ms: score.elapsedMs,
        base_points: score.basePoints,
        bonus_points: score.bonusPoints,
      })
      .select("*")
      .single();

    if (answerError) {
      // Check if it's a duplicate (race condition)
      if (answerError.code === "23505") {
        // Fetch existing answer
        const { data: existing } = await supabase
          .from("attempt_answers")
          .select("*")
          .eq("attempt_id", attempt_id)
          .eq("question_id", question_id)
          .single();

        if (existing) {
          const nextIndex = attempt.current_index + 1;
          const { data: nextQuestions } = await supabase
            .from("quiz_play_view")
            .select("*")
            .eq("quiz_id", attempt.quiz_id)
            .eq("order_index", nextIndex);

          return successResponse(
            {
              attempt_id,
              question_id,
              answer_id: existing.id,
              is_correct: existing.is_correct,
              base_points: existing.base_points,
              bonus_points: existing.bonus_points,
              total_points: existing.base_points + existing.bonus_points,
              time_ms: existing.time_ms,
              next_question: nextQuestions?.[0] || null,
              current_index: attempt.current_index,
            },
            requestId
          );
        }
      }

      logStructured(requestId, "submit_answer_insert_error", {
        error: answerError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to save answer",
        requestId,
        500
      );
    }

    // Update attempt: increment current_index, update totals, set next question timing
    const nextIndex = attempt.current_index + 1;
    const nextQuestionStartedAt = new Date();
    const nextQuestionExpiresAt = new Date(
      nextQuestionStartedAt.getTime() + QUESTION_TIME_LIMIT_MS
    );

    const newTotalScore = Number(attempt.total_score) + score.totalPoints;
    const newTotalTimeMs = attempt.total_time_ms + score.elapsedMs;

    const { error: updateError } = await supabase
      .from("attempts")
      .update({
        current_index: nextIndex,
        total_score: newTotalScore,
        total_time_ms: newTotalTimeMs,
        current_question_started_at:
          nextIndex <= 10
            ? nextQuestionStartedAt.toISOString()
            : null,
        current_question_expires_at:
          nextIndex <= 10 ? nextQuestionExpiresAt.toISOString() : null,
      })
      .eq("id", attempt_id);

    if (updateError) {
      logStructured(requestId, "submit_answer_update_error", {
        error: updateError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to update attempt",
        requestId,
        500
      );
    }

    // Get next question if available
    const { data: nextQuestions } = await supabase
      .from("quiz_play_view")
      .select("*")
      .eq("quiz_id", attempt.quiz_id)
      .eq("order_index", nextIndex);

    // Write event to outbox
    await supabase.from("outbox_events").insert({
      aggregate_type: "attempt",
      aggregate_id: attempt_id,
      event_type: "AnswerSubmitted",
      event_version: 1,
      actor_user_id: userId,
      payload: {
        attempt_id,
        question_id,
        is_correct: isCorrect,
        score: score.totalPoints,
        time_ms: score.elapsedMs,
      },
      trace_id: requestId,
    });

    logStructured(requestId, "submit_answer_success", {
      attempt_id,
      question_id,
      is_correct: isCorrect,
      score: score.totalPoints,
    });

    return successResponse(
      {
        attempt_id,
        question_id,
        is_correct: isCorrect,
        base_points: score.basePoints,
        bonus_points: score.bonusPoints,
        total_points: score.totalPoints,
        time_ms: score.elapsedMs,
        next_question: nextQuestions?.[0] || null,
        current_index: nextIndex,
        question_started_at:
          nextIndex <= 10 ? nextQuestionStartedAt.toISOString() : null,
        question_expires_at:
          nextIndex <= 10 ? nextQuestionExpiresAt.toISOString() : null,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "submit_answer_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

