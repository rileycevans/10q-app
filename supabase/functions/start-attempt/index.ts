/**
 * Start Attempt Edge Function
 * Creates a new attempt or returns existing one (idempotent on player_id, quiz_id)
 * Sets server-authoritative timing for first question
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
  logStructured(requestId, "start_attempt_request", {});

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

    // Ensure player exists (create if not)
    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("id")
      .eq("id", userId)
      .single();

    if (playerError && playerError.code === "PGRST116") {
      // Player doesn't exist, create one with auto-generated handle
      const handleDisplay = `Player${userId.slice(0, 8)}`;
      const handleCanonical = handleDisplay.toLowerCase();

      const { error: createError } = await supabase
        .from("players")
        .insert({
          id: userId,
          linked_auth_user_id: userId,
          handle_display: handleDisplay,
          handle_canonical: handleCanonical,
        });

      if (createError) {
        logStructured(requestId, "start_attempt_player_error", {
          error: createError.message,
        });
        return errorResponse(
          ErrorCodes.SERVICE_UNAVAILABLE,
          "Failed to create player",
          requestId,
          500
        );
      }
    } else if (playerError) {
      logStructured(requestId, "start_attempt_player_error", {
        error: playerError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to fetch player",
        requestId,
        500
      );
    }

    // Check if attempt already exists (idempotent)
    const { data: existingAttempt, error: attemptError } = await supabase
      .from("attempts")
      .select("id, quiz_id, current_index, finalized_at, current_question_started_at, current_question_expires_at")
      .eq("player_id", userId)
      .eq("quiz_id", quiz_id)
      .single();

    if (existingAttempt) {
      // Attempt exists - return it
      if (existingAttempt.finalized_at) {
        // Already finalized - return state indicating completion
        logStructured(requestId, "start_attempt_already_finalized", {
          attempt_id: existingAttempt.id,
        });
        return successResponse(
          {
            attempt_id: existingAttempt.id,
            quiz_id: existingAttempt.quiz_id,
            current_index: existingAttempt.current_index,
            current_question: null,
            question_started_at: null,
            question_expires_at: null,
            state: "FINALIZED",
          },
          requestId
        );
      }

      // Check if all questions answered (ready to finalize)
      if (existingAttempt.current_index > 10) {
        logStructured(requestId, "start_attempt_ready_to_finalize", {
          attempt_id: existingAttempt.id,
        });
        return successResponse(
          {
            attempt_id: existingAttempt.id,
            quiz_id: existingAttempt.quiz_id,
            current_index: existingAttempt.current_index,
            current_question: null,
            question_started_at: null,
            question_expires_at: null,
            state: "READY_TO_FINALIZE",
          },
          requestId
        );
      }

      // Get current question from quiz_play_view
      const { data: questions, error: questionsError } = await supabase
        .from("quiz_play_view")
        .select("*")
        .eq("quiz_id", quiz_id)
        .eq("order_index", existingAttempt.current_index);

      if (questionsError || !questions || questions.length === 0) {
        logStructured(requestId, "start_attempt_question_error", {
          error: questionsError?.message,
        });
        return errorResponse(
          ErrorCodes.QUESTION_NOT_FOUND,
          "Question not found",
          requestId,
          404
        );
      }

      logStructured(requestId, "start_attempt_existing", {
        attempt_id: existingAttempt.id,
      });

      return successResponse(
        {
          attempt_id: existingAttempt.id,
          quiz_id: existingAttempt.quiz_id,
          current_index: existingAttempt.current_index,
          current_question: questions[0],
          question_started_at: existingAttempt.current_question_started_at,
          question_expires_at: existingAttempt.current_question_expires_at,
          state: "IN_PROGRESS",
        },
        requestId
      );
    }

    // Verify quiz exists and is published
    const { data: quiz, error: quizError } = await supabase
      .from("quizzes")
      .select("id, status")
      .eq("id", quiz_id)
      .eq("status", "published")
      .single();

    if (quizError || !quiz) {
      return errorResponse(
        ErrorCodes.QUIZ_NOT_FOUND,
        "Quiz not found or not published",
        requestId,
        404
      );
    }

    // Create new attempt
    const now = new Date();
    const questionExpiresAt = new Date(now.getTime() + 16000); // 16 seconds

    const { data: newAttempt, error: createAttemptError } = await supabase
      .from("attempts")
      .insert({
        quiz_id,
        player_id: userId,
        current_index: 1,
        current_question_started_at: now.toISOString(),
        current_question_expires_at: questionExpiresAt.toISOString(),
      })
      .select("id, quiz_id, current_index, current_question_started_at, current_question_expires_at")
      .single();

    if (createAttemptError) {
      // Check if it's a unique constraint violation (race condition)
      if (createAttemptError.code === "23505") {
        // Attempt was created by another request, fetch it
        const { data: raceAttempt } = await supabase
          .from("attempts")
          .select("id, quiz_id, current_index, current_question_started_at, current_question_expires_at")
          .eq("player_id", userId)
          .eq("quiz_id", quiz_id)
          .single();

        if (raceAttempt) {
          const { data: questions } = await supabase
            .from("quiz_play_view")
            .select("*")
            .eq("quiz_id", quiz_id)
            .eq("order_index", raceAttempt.current_index);

          return successResponse(
            {
              attempt_id: raceAttempt.id,
              quiz_id: raceAttempt.quiz_id,
              current_index: raceAttempt.current_index,
              current_question: questions?.[0],
              question_started_at: raceAttempt.current_question_started_at,
              question_expires_at: raceAttempt.current_question_expires_at,
            },
            requestId
          );
        }
      }

      logStructured(requestId, "start_attempt_create_error", {
        error: createAttemptError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to create attempt",
        requestId,
        500
      );
    }

    // Get first question from quiz_play_view
    const { data: questions, error: questionsError } = await supabase
      .from("quiz_play_view")
      .select("*")
      .eq("quiz_id", quiz_id)
      .eq("order_index", 1);

    if (questionsError || !questions || questions.length === 0) {
      logStructured(requestId, "start_attempt_question_error", {
        error: questionsError?.message,
      });
      return errorResponse(
        ErrorCodes.QUESTION_NOT_FOUND,
        "Question not found",
        requestId,
        404
      );
    }

    logStructured(requestId, "start_attempt_success", {
      attempt_id: newAttempt.id,
    });

    return successResponse(
      {
        attempt_id: newAttempt.id,
        quiz_id: newAttempt.quiz_id,
        current_index: newAttempt.current_index,
        current_question: questions[0],
        question_started_at: newAttempt.current_question_started_at,
        question_expires_at: newAttempt.current_question_expires_at,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "start_attempt_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

