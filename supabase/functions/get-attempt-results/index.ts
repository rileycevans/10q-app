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

    // Fetch question details for each answer (Notion plan: body, question_answers, question_tags with tag_id)
    const questionIds = answers.map((a) => a.question_id);
    
    // Get questions with answers and tags
    const { data: questions, error: questionsError } = await supabase
      .from("questions")
      .select(`
        id,
        body,
        question_answers (
          id,
          body,
          sort_index,
          is_correct
        ),
        question_tags (
          tag_id,
          tags (
            id,
            name,
            slug
          )
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

    // Get order_index from quiz_questions junction table
    const { data: quizQuestions } = await supabase
      .from("quiz_questions")
      .select("question_id, order_index")
      .eq("quiz_id", attempt.quiz_id)
      .in("question_id", questionIds);

    // Create maps for quick lookup
    const questionMap = new Map();
    questions?.forEach((q: any) => {
      questionMap.set(q.id, q);
    });

    const orderMap = new Map();
    quizQuestions?.forEach((qq: any) => {
      orderMap.set(qq.question_id, qq.order_index);
    });

    // Format the response (Notion plan field names)
    const questionResults = answers
      .map((answer) => {
        const question = questionMap.get(answer.question_id);
        if (!question) return null;

        const selectedAnswer = question.question_answers?.find(
          (a: any) => a.id === answer.selected_answer_id
        );

        return {
          question_id: answer.question_id,
          order_index: orderMap.get(answer.question_id) || 0,
          body: question.body || "",
          tags: question.question_tags?.map((t: any) => t.tags?.name).filter(Boolean) || [],
          answers: question.question_answers
            ?.sort((a: any, b: any) => a.sort_index - b.sort_index)
            .map((a: any) => ({
              id: a.id,
              body: a.body,
              sort_index: a.sort_index,
              is_correct: a.is_correct,
            })) || [],
          selected_answer_id: answer.selected_answer_id,
          selected_answer_body: selectedAnswer?.body || null,
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

    // Get daily score (Notion plan: daily_scores table)
    const { data: dailyScore } = await supabase
      .from("daily_scores")
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
        daily_score: dailyScore || null,
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

