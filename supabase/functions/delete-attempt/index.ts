/**
 * Delete Attempt Edge Function
 * Development-only: Deletes an attempt and all related data to allow retaking quizzes
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
  logStructured(requestId, "delete_attempt_request", {});

  try {
    // Authenticate user
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const { userId } = authResult;

    // Parse request body
    const body = await req.json();
    const { quiz_id } = body;

    if (!quiz_id) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "quiz_id is required",
        requestId,
        400
      );
    }

    const supabase = createServiceClient();

    // Find the attempt for this user and quiz
    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("id")
      .eq("player_id", userId)
      .eq("quiz_id", quiz_id)
      .single();

    if (attemptError && attemptError.code === "PGRST116") {
      // No attempt found - that's fine, nothing to delete
      return successResponse(
        {
          deleted: false,
          message: "No attempt found to delete",
        },
        requestId
      );
    }

    if (attemptError || !attempt) {
      logStructured(requestId, "delete_attempt_fetch_error", {
        error: attemptError?.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to fetch attempt",
        requestId,
        500
      );
    }

    const attemptId = attempt.id;

    // Delete related data in correct order (respecting foreign key constraints)
    // 1. Delete attempt_answers (references attempts)
    const { error: answersError } = await supabase
      .from("attempt_answers")
      .delete()
      .eq("attempt_id", attemptId);

    if (answersError) {
      logStructured(requestId, "delete_attempt_answers_error", {
        error: answersError.message,
      });
      // Continue anyway - try to delete the attempt
    }

    // 2. Delete daily_scores (references quiz_id and player_id)
    const { error: dailyScoreError } = await supabase
      .from("daily_scores")
      .delete()
      .eq("quiz_id", quiz_id)
      .eq("player_id", userId);

    if (dailyScoreError) {
      logStructured(requestId, "delete_attempt_daily_score_error", {
        error: dailyScoreError.message,
      });
      // Continue anyway - try to delete the attempt
    }

    // 3. Delete the attempt itself
    const { error: deleteError } = await supabase
      .from("attempts")
      .delete()
      .eq("id", attemptId)
      .eq("player_id", userId); // Extra safety check

    if (deleteError) {
      logStructured(requestId, "delete_attempt_error", {
        error: deleteError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to delete attempt",
        requestId,
        500
      );
    }

    logStructured(requestId, "delete_attempt_success", {
      attempt_id: attemptId,
      quiz_id,
    });

    return successResponse(
      {
        deleted: true,
        attempt_id: attemptId,
        quiz_id,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "delete_attempt_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});
