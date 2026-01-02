/**
 * Finalize Attempt Edge Function
 * Validates all 10 questions answered, writes to daily_results, makes attempt immutable
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";

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
  logStructured(requestId, "finalize_attempt_request", {});

  try {
    // Authenticate user
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    // Parse request body
    const body = await req.json();
    const { attempt_id } = body;

    if (!attempt_id) {
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

    // Check if already finalized
    if (attempt.finalized_at) {
      // Return existing results
      const { data: dailyResult } = await supabase
        .from("daily_results")
        .select("*")
        .eq("quiz_id", attempt.quiz_id)
        .eq("player_id", userId)
        .single();

      return successResponse(
        {
          attempt_id,
          finalized_at: attempt.finalized_at,
          total_score: attempt.total_score,
          total_time_ms: attempt.total_time_ms,
          daily_result: dailyResult,
        },
        requestId
      );
    }

    // Verify all 10 questions have answers
    const { data: answers, error: answersError } = await supabase
      .from("attempt_answers")
      .select("question_id")
      .eq("attempt_id", attempt_id);

    if (answersError) {
      logStructured(requestId, "finalize_attempt_answers_error", {
        error: answersError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to fetch answers",
        requestId,
        500
      );
    }

    if (!answers || answers.length < 10) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Attempt incomplete: ${answers?.length || 0}/10 questions answered`,
        requestId,
        400
      );
    }

    // Count correct answers
    const { data: correctAnswers } = await supabase
      .from("attempt_answers")
      .select("is_correct")
      .eq("attempt_id", attempt_id)
      .eq("is_correct", true);

    const correctCount = correctAnswers?.length || 0;

    // Finalize attempt
    const now = new Date();
    const { error: finalizeError } = await supabase
      .from("attempts")
      .update({
        finalized_at: now.toISOString(),
      })
      .eq("id", attempt_id);

    if (finalizeError) {
      logStructured(requestId, "finalize_attempt_update_error", {
        error: finalizeError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to finalize attempt",
        requestId,
        500
      );
    }

    // Write to daily_results (immutable, append-only)
    const { data: dailyResult, error: dailyResultError } = await supabase
      .from("daily_results")
      .insert({
        quiz_id: attempt.quiz_id,
        player_id: userId,
        completed_at: now.toISOString(),
        score: attempt.total_score,
        total_time_ms: attempt.total_time_ms,
        correct_count: correctCount,
      })
      .select("*")
      .single();

    if (dailyResultError) {
      logStructured(requestId, "finalize_attempt_daily_result_error", {
        error: dailyResultError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to create daily result",
        requestId,
        500
      );
    }

    // Write event to outbox
    await supabase.from("outbox_events").insert({
      aggregate_type: "attempt",
      aggregate_id: attempt_id,
      event_type: "AttemptCompleted",
      event_version: 1,
      actor_user_id: userId,
      payload: {
        attempt_id,
        quiz_id: attempt.quiz_id,
        score: attempt.total_score,
        total_time_ms: attempt.total_time_ms,
        correct_count: correctCount,
      },
      trace_id: requestId,
    });

    logStructured(requestId, "finalize_attempt_success", {
      attempt_id,
      score: attempt.total_score,
      correct_count: correctCount,
    });

    return successResponse(
      {
        attempt_id,
        finalized_at: now.toISOString(),
        total_score: attempt.total_score,
        total_time_ms: attempt.total_time_ms,
        correct_count: correctCount,
        daily_result: dailyResult,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "finalize_attempt_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

