/**
 * Start Question Timer Edge Function
 * Starts the timer for the current question when the client is ready
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";
import { planQuestionTimerStart } from "../_shared/attempt-state.ts";
import { QUESTION_TIME_LIMIT_MS } from "../_shared/scoring.ts";

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
  logStructured(requestId, "start_question_timer_request", {});

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

    const plan = planQuestionTimerStart(
      attempt,
      Date.now(),
      QUESTION_TIME_LIMIT_MS,
    );

    if (plan.action === "error") {
      return errorResponse(plan.code, plan.message, requestId, plan.status);
    }

    if (plan.action === "noop") {
      logStructured(requestId, "start_question_timer_already_started", {
        attempt_id,
      });
      return successResponse(
        {
          attempt_id,
          question_started_at: plan.questionStartedAt,
          question_expires_at: plan.questionExpiresAt,
        },
        requestId
      );
    }

    const { error: updateError } = await supabase
      .from("attempts")
      .update({
        current_question_started_at: plan.questionStartedAt,
        current_question_expires_at: plan.questionExpiresAt,
      })
      .eq("id", attempt_id);

    if (updateError) {
      logStructured(requestId, "start_question_timer_update_error", {
        error: updateError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to start timer",
        requestId,
        500
      );
    }

    logStructured(requestId, "start_question_timer_success", {
      attempt_id,
    });

    return successResponse(
      {
        attempt_id,
        question_started_at: plan.questionStartedAt,
        question_expires_at: plan.questionExpiresAt,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "start_question_timer_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});
