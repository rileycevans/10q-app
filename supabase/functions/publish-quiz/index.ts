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
 * Validate quiz before publishing (Notion plan: quiz_questions junction, question_answers with is_correct)
 */
async function validateQuiz(
  supabase: ReturnType<typeof createServiceClient>,
  quizId: string
): Promise<{ valid: boolean; error?: string }> {
  // Check quiz has exactly 10 questions via quiz_questions junction
  const { data: quizQuestions, error: questionsError } = await supabase
    .from("quiz_questions")
    .select("question_id, order_index")
    .eq("quiz_id", quizId);

  if (questionsError) {
    return { valid: false, error: `Failed to fetch quiz questions: ${questionsError.message}` };
  }

  if (!quizQuestions || quizQuestions.length !== MAX_QUESTIONS_PER_QUIZ) {
    return {
      valid: false,
      error: `Quiz must have exactly ${MAX_QUESTIONS_PER_QUIZ} questions, found ${quizQuestions?.length || 0}`,
    };
  }

  // Verify order_index is 1-10 with no gaps
  const orderIndexes = quizQuestions.map(qq => qq.order_index).sort((a, b) => a - b);
  for (let i = 0; i < MAX_QUESTIONS_PER_QUIZ; i++) {
    if (orderIndexes[i] !== i + 1) {
      return {
        valid: false,
        error: `Quiz questions must have order_index 1-10, found gap or duplicate`,
      };
    }
  }

  // Validate each question
  for (const quizQuestion of quizQuestions) {
    const questionId = quizQuestion.question_id;

    // Check question has exactly 4 answers (Notion plan: question_answers)
    const { data: answers, error: answersError } = await supabase
      .from("question_answers")
      .select("id, is_correct, sort_index")
      .eq("question_id", questionId);

    if (answersError) {
      return {
        valid: false,
        error: `Failed to fetch answers for question ${questionId}: ${answersError.message}`,
      };
    }

    if (!answers || answers.length !== CHOICES_PER_QUESTION) {
      return {
        valid: false,
        error: `Question ${questionId} must have exactly ${CHOICES_PER_QUESTION} answers, found ${answers?.length || 0}`,
      };
    }

    // Verify sort_index is 0-3 with no gaps (Notion plan: sort_index 0-3)
    const sortIndexes = answers.map(a => a.sort_index).sort((a, b) => a - b);
    for (let i = 0; i < CHOICES_PER_QUESTION; i++) {
      if (sortIndexes[i] !== i) {
        return {
          valid: false,
          error: `Question ${questionId} answers must have sort_index 0-3, found gap or duplicate`,
        };
      }
    }

    // Check exactly one answer is correct (Notion plan: is_correct on question_answers)
    const correctAnswers = answers.filter(a => a.is_correct);
    if (correctAnswers.length !== 1) {
      return {
        valid: false,
        error: `Question ${questionId} must have exactly 1 correct answer, found ${correctAnswers.length}`,
      };
    }

    // Check question has 1-5 tags (Notion plan: question_tags with tag_id)
    const { data: tags, error: tagsError } = await supabase
      .from("question_tags")
      .select("tag_id")
      .eq("question_id", questionId);

    if (tagsError) {
      return {
        valid: false,
        error: `Failed to fetch tags for question ${questionId}: ${tagsError.message}`,
      };
    }

    if (!tags || tags.length < MIN_TAGS_PER_QUESTION || tags.length > MAX_TAGS_PER_QUESTION) {
      return {
        valid: false,
        error: `Question ${questionId} must have ${MIN_TAGS_PER_QUESTION}-${MAX_TAGS_PER_QUESTION} tags, found ${tags?.length || 0}`,
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

