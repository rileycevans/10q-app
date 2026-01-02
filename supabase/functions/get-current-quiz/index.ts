/**
 * Get Current Quiz Edge Function
 * Returns the currently published quiz (latest with release_at_utc <= now())
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";
import { ErrorCodes } from "../_shared/response.ts";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  logStructured(requestId, "get_current_quiz_request", {});

  try {
    const supabase = createServiceClient();

    // Get current quiz: latest published with release_at_utc <= now()
    const { data: quiz, error } = await supabase
      .from("quizzes")
      .select("id, release_at_utc, status, created_at")
      .eq("status", "published")
      .lte("release_at_utc", new Date().toISOString())
      .order("release_at_utc", { ascending: false })
      .limit(1)
      .single();

    if (error || !quiz) {
      logStructured(requestId, "get_current_quiz_not_found", { error: error?.message });
      return errorResponse(
        ErrorCodes.QUIZ_NOT_AVAILABLE,
        "No quiz is currently available",
        requestId,
        503
      );
    }

    logStructured(requestId, "get_current_quiz_success", { quiz_id: quiz.id });
    return successResponse(
      {
        quiz_id: quiz.id,
        release_at_utc: quiz.release_at_utc,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "get_current_quiz_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

