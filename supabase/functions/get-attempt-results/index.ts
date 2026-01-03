/**
 * Get Attempt Results Edge Function
 * Returns detailed results for a finalized attempt including question breakdown
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

  if (req.method !== "GET") {
    return errorResponse(
      ErrorCodes.VALIDATION_ERROR,
      "Method not allowed",
      generateRequestId(),
      405
    );
  }

  const requestId = generateRequestId();
  logStructured(requestId, "get_attempt_results_request", {});

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

    // Verify attempt is finalized
    if (!attempt.finalized_at) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Attempt is not finalized",
        requestId,
        400
      );
    }

    // Fetch all attempt answers
    const { data: answers, error: answersError } = await supabase
      .from("attempt_answers")
      .select("*")
      .eq("attempt_id", attemptId);

    if (answersError) {
      logStructured(requestId, "get_attempt_results_answers_error", {
        error: answersError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to fetch answers",
        requestId,
        500
      );
    }

    if (!answers || answers.length === 0) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No answers found for this attempt",
        requestId,
        400
      );
    }

    // Fetch question details for each answer
    const questionIds = answers.map((a) => a.question_id);
    const { data: questions, error: questionsError } = await supabase
      .from("questions")
      .select(`
        id,
        prompt,
        order_index,
        question_choices (
          id,
          text,
          order_index
        ),
        question_tags (
          tag
        )
      `)
      .in("id", questionIds);

    if (questionsError) {
      logStructured(requestId, "get_attempt_results_questions_error", {
        error: questionsError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to fetch questions",
        requestId,
        500
      );
    }

    // Create a map for quick lookup
    const questionMap = new Map();
    questions?.forEach((q: any) => {
      questionMap.set(q.id, q);
    });

    // Format the response
    const questionResults = answers
      .map((answer) => {
        const question = questionMap.get(answer.question_id);
        if (!question) return null;

        const selectedChoice = question.question_choices?.find(
          (c: any) => c.id === answer.selected_answer_id
        );

        return {
          question_id: answer.question_id,
          order_index: question.order_index || 0,
          prompt: question.prompt || "",
          tags: question.question_tags?.map((t: any) => t.tag) || [],
          choices: question.question_choices
            ?.sort((a: any, b: any) => a.order_index - b.order_index)
            .map((c: any) => ({
              id: c.id,
              text: c.text,
              order_index: c.order_index,
            })) || [],
          selected_choice_id: answer.selected_answer_id,
          selected_choice_text: selectedChoice?.text || null,
          answer_kind: answer.answer_kind,
          is_correct: answer.is_correct,
          time_ms: answer.time_ms,
          base_points: answer.base_points,
          bonus_points: answer.bonus_points,
          total_points: answer.base_points + answer.bonus_points,
        };
      })
      .filter((q) => q !== null)
      .sort((a: any, b: any) => a.order_index - b.order_index);

    // Get daily result
    const { data: dailyResult } = await supabase
      .from("daily_results")
      .select("*")
      .eq("quiz_id", attempt.quiz_id)
      .eq("player_id", userId)
      .single();

    logStructured(requestId, "get_attempt_results_success", {
      attempt_id: attemptId,
      question_count: questionResults.length,
    });

    return successResponse(
      {
        attempt_id: attempt.id,
        quiz_id: attempt.quiz_id,
        finalized_at: attempt.finalized_at,
        total_score: Number(attempt.total_score),
        total_time_ms: attempt.total_time_ms,
        correct_count: questionResults.filter((q: any) => q && q.is_correct).length,
        questions: questionResults,
        daily_result: dailyResult || null,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "get_attempt_results_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

