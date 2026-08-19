/**
 * Delete Attempt Edge Function
 *
 * Admin-only: deletes an attempt and its related data so a quiz can be retaken.
 * Used by the admin "reset quiz" affordance while testing a day's quiz.
 *
 * SECURITY (blocking-fix A1). This function authenticated the caller and then
 * deleted *their own* attempt with no further check. Combined with
 * get-attempt-results — which returns is_correct for every choice of every
 * question once an attempt is finalized — any signed-in user could:
 *
 *   finalize → read the full answer key → delete the attempt → replay for 100
 *
 * repeatably, daily, indistinguishable from a legitimate score in daily_scores.
 * Every visitor is auto-signed-in via signInAnonymously(), so "signed in" was
 * not a meaningful barrier: a brand-new anonymous session reached this endpoint.
 * The only thing stopping it was a client-side `if (!isAdmin)` in page.tsx that
 * merely hid a button.
 *
 * Two independent gates now, deliberately:
 *   1. A server-side admin check, mirroring create-quiz.
 *   2. A refusal to delete an attempt that has been finalized.
 *
 * (2) is what actually kills the replay loop, and it holds even if the role
 * check is ever misconfigured — the exploit requires finalizing first, because
 * the answer key is only released at finalize.
 */

import { corsHeaders, corsHeadersFor } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(req) });
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

    const supabase = createServiceClient();

    // Gate 1: server-side admin check. Mirrors create-quiz/index.ts — the
    // client-side check in page.tsx only hides the button.
    const { data: { user }, error: userError } =
      await supabase.auth.admin.getUserById(userId);

    if (userError || !user) {
      return errorResponse(
        ErrorCodes.NOT_AUTHORIZED,
        "User not found",
        requestId,
        403
      );
    }

    if (user.app_metadata?.role !== "admin") {
      logStructured(requestId, "delete_attempt_forbidden", {
        reason: "not_admin",
      });
      return errorResponse(
        ErrorCodes.NOT_AUTHORIZED,
        "Admin access required",
        requestId,
        403
      );
    }

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

    // Find the attempt for this user and quiz
    const { data: attempt, error: attemptError } = await supabase
      .from("attempts")
      .select("id, finalized_at")
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

    // Gate 2: refuse to delete a finalized attempt.
    //
    // This is the gate that actually closes the replay loop. The answer key is
    // only released by get-attempt-results once an attempt is finalized, so an
    // attacker must finalize before they learn anything worth replaying — and
    // from that point the attempt can no longer be deleted. A score, once
    // recorded in daily_scores, is now permanent.
    //
    // Resetting an *unfinished* attempt stays possible, which is what the admin
    // reset affordance is actually for.
    if (attempt.finalized_at) {
      logStructured(requestId, "delete_attempt_refused_finalized", {
        attempt_id: attemptId,
        quiz_id,
      });
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Cannot delete a finalized attempt",
        requestId,
        409
      );
    }

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
