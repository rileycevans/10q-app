/**
 * Publish Quiz Edge Function
 * Validates and publishes draft quizzes at 11:30 UTC
 * Idempotent: safe to re-run
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";

const MAX_QUESTIONS_PER_QUIZ = 10;
const CHOICES_PER_QUESTION = 4;
const MIN_TAGS_PER_QUESTION = 1;
const MAX_TAGS_PER_QUESTION = 5;

/**
 * Validate quiz before publishing
 */
async function validateQuiz(
  supabase: ReturnType<typeof createServiceClient>,
  quizId: string
): Promise<{ valid: boolean; error?: string }> {
  // Check quiz has exactly 10 questions
  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("id")
    .eq("quiz_id", quizId);

  if (questionsError) {
    return { valid: false, error: `Failed to fetch questions: ${questionsError.message}` };
  }

  if (!questions || questions.length !== MAX_QUESTIONS_PER_QUIZ) {
    return {
      valid: false,
      error: `Quiz must have exactly ${MAX_QUESTIONS_PER_QUIZ} questions, found ${questions?.length || 0}`,
    };
  }

  // Validate each question
  for (const question of questions) {
    // Check question has exactly 4 choices
    const { data: choices, error: choicesError } = await supabase
      .from("question_choices")
      .select("id")
      .eq("question_id", question.id);

    if (choicesError) {
      return {
        valid: false,
        error: `Failed to fetch choices for question ${question.id}: ${choicesError.message}`,
      };
    }

    if (!choices || choices.length !== CHOICES_PER_QUESTION) {
      return {
        valid: false,
        error: `Question ${question.id} must have exactly ${CHOICES_PER_QUESTION} choices, found ${choices?.length || 0}`,
      };
    }

    // Check question has 1-5 tags
    const { data: tags, error: tagsError } = await supabase
      .from("question_tags")
      .select("tag")
      .eq("question_id", question.id);

    if (tagsError) {
      return {
        valid: false,
        error: `Failed to fetch tags for question ${question.id}: ${tagsError.message}`,
      };
    }

    if (!tags || tags.length < MIN_TAGS_PER_QUESTION || tags.length > MAX_TAGS_PER_QUESTION) {
      return {
        valid: false,
        error: `Question ${question.id} must have ${MIN_TAGS_PER_QUESTION}-${MAX_TAGS_PER_QUESTION} tags, found ${tags?.length || 0}`,
      };
    }

    // Check correct answer exists
    const { data: correctAnswer, error: correctError } = await supabase
      .from("private.correct_answers")
      .select("correct_choice_id")
      .eq("question_id", question.id)
      .single();

    if (correctError || !correctAnswer) {
      return {
        valid: false,
        error: `Question ${question.id} is missing correct answer`,
      };
    }
  }

  return { valid: true };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  logStructured(requestId, "publish_quiz_request", {});

  try {
    const supabase = createServiceClient();

    // Find draft quiz with release_at_utc <= now()
    const now = new Date();
    const { data: draftQuiz, error: quizError } = await supabase
      .from("quizzes")
      .select("id, release_at_utc, status")
      .eq("status", "draft")
      .lte("release_at_utc", now.toISOString())
      .order("release_at_utc", { ascending: false })
      .limit(1)
      .single();

    if (quizError || !draftQuiz) {
      logStructured(requestId, "publish_quiz_no_draft", {});
      return successResponse(
        {
          published: false,
          message: "No draft quiz ready to publish",
        },
        requestId
      );
    }

    // Check if already published (idempotency)
    if (draftQuiz.status === "published") {
      logStructured(requestId, "publish_quiz_already_published", {
        quiz_id: draftQuiz.id,
      });
      return successResponse(
        {
          published: false,
          message: "Quiz already published",
          quiz_id: draftQuiz.id,
        },
        requestId
      );
    }

    // Validate quiz
    const validation = await validateQuiz(supabase, draftQuiz.id);
    if (!validation.valid) {
      logStructured(requestId, "publish_quiz_validation_failed", {
        quiz_id: draftQuiz.id,
        error: validation.error,
      });
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `Quiz validation failed: ${validation.error}`,
        requestId,
        400
      );
    }

    // Publish quiz
    const { error: publishError } = await supabase
      .from("quizzes")
      .update({ status: "published" })
      .eq("id", draftQuiz.id);

    if (publishError) {
      logStructured(requestId, "publish_quiz_error", {
        quiz_id: draftQuiz.id,
        error: publishError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to publish quiz",
        requestId,
        500
      );
    }

    // Write event to outbox
    await supabase.from("outbox_events").insert({
      aggregate_type: "quiz",
      aggregate_id: draftQuiz.id,
      event_type: "QuizPublished",
      event_version: 1,
      payload: {
        quiz_id: draftQuiz.id,
        release_at_utc: draftQuiz.release_at_utc,
        published_at: now.toISOString(),
      },
      trace_id: requestId,
    });

    logStructured(requestId, "publish_quiz_success", {
      quiz_id: draftQuiz.id,
    });

    return successResponse(
      {
        published: true,
        quiz_id: draftQuiz.id,
        release_at_utc: draftQuiz.release_at_utc,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "publish_quiz_error", { error: error.message });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

