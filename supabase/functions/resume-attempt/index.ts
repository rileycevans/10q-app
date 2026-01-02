/**
 * Resume Attempt Edge Function
 * Handles expired questions on resume (auto-expire and advance)
 * Attempt remains bound to original quiz_id
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";

const QUESTION_TIME_LIMIT_MS = 16000;

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return errorResponse(
      ErrorCodes.VALIDATION_ERROR,
      "Method not allowed",
      generateRequestId(),
      405
    );
  }

  const requestId = generateRequestId();
  logStructured(requestId, "resume_attempt_request", {});

  try {
    // Authenticate user
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    // Get attempt_id from query params
    const url = new URL(req.url);
    const attemptId = url.searchParams.get("attempt_id");

    if (!attemptId) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "attempt_id is required",
        requestId,
        400
      );
    }

    const supabase = createServiceClient();

    // Fetch attempt and verify ownership
    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("*")
      .eq("id", attemptId)
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

    const now = new Date();
    let currentAttempt = attempt;
    let currentIndex = attempt.current_index;

    // Handle expired questions: auto-expire and advance
    while (currentIndex <= 10 && currentAttempt.current_question_started_at) {
      const questionStartedAt = new Date(
        currentAttempt.current_question_started_at
      );
      const elapsedMs = now.getTime() - questionStartedAt.getTime();

      if (elapsedMs >= QUESTION_TIME_LIMIT_MS) {
        // Question expired - mark as timeout and advance
        const { data: question } = await supabase
          .from("questions")
          .select("id")
          .eq("quiz_id", currentAttempt.quiz_id)
          .eq("order_index", currentIndex)
          .single();

        if (question) {
          // Check if already answered
          const { data: existingAnswer } = await supabase
            .from("attempt_answers")
            .select("*")
            .eq("attempt_id", attemptId)
            .eq("question_id", question.id)
            .single();

          if (!existingAnswer) {
            // Insert timeout answer
            await supabase.from("attempt_answers").insert({
              attempt_id: attemptId,
              question_id: question.id,
              answer_kind: "timeout",
              selected_answer_id: null,
              is_correct: false,
              time_ms: QUESTION_TIME_LIMIT_MS,
              base_points: 0,
              bonus_points: 0,
            });

            // Update attempt totals
            const { data: updatedAttempt } = await supabase
              .from("attempts")
              .select("*")
              .eq("id", attemptId)
              .single();

            currentAttempt = updatedAttempt;
          }
        }

        // Advance to next question
        currentIndex++;
        const nextQuestionStartedAt = new Date();
        const nextQuestionExpiresAt = new Date(
          nextQuestionStartedAt.getTime() + QUESTION_TIME_LIMIT_MS
        );

        await supabase
          .from("attempts")
          .update({
            current_index: currentIndex,
            current_question_started_at:
              currentIndex <= 10
                ? nextQuestionStartedAt.toISOString()
                : null,
            current_question_expires_at:
              currentIndex <= 10 ? nextQuestionExpiresAt.toISOString() : null,
          })
          .eq("id", attemptId);

        // Fetch updated attempt
        const { data: updated } = await supabase
          .from("attempts")
          .select("*")
          .eq("id", attemptId)
          .single();

        currentAttempt = updated;
      } else {
        // Question not expired, break loop
        break;
      }
    }

    // Get current question from quiz_play_view
    const { data: questions, error: questionsError } = await supabase
      .from("quiz_play_view")
      .select("*")
      .eq("quiz_id", currentAttempt.quiz_id)
      .eq("order_index", currentIndex);

    if (questionsError || !questions || questions.length === 0) {
      // No more questions - attempt should be finalized
      logStructured(requestId, "resume_attempt_no_questions", {
        attempt_id: attemptId,
        current_index: currentIndex,
      });

      return successResponse(
        {
          attempt_id: attemptId,
          quiz_id: currentAttempt.quiz_id,
          current_index: currentIndex,
          current_question: null,
          question_started_at: null,
          question_expires_at: null,
          is_complete: true,
        },
        requestId
      );
    }

    logStructured(requestId, "resume_attempt_success", {
      attempt_id: attemptId,
      current_index: currentIndex,
    });

    return successResponse(
      {
        attempt_id: attemptId,
        quiz_id: currentAttempt.quiz_id,
        current_index: currentIndex,
        current_question: questions[0],
        question_started_at: currentAttempt.current_question_started_at,
        question_expires_at: currentAttempt.current_question_expires_at,
        is_complete: false,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "resume_attempt_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

