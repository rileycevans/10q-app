/**
 * Create Quiz Edge Function
 * Admin-only: creates a quiz with questions, answers, and optional tags.
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";

interface AnswerInput {
  body: string;
  is_correct: boolean;
}

interface QuestionInput {
  body: string;
  answers: AnswerInput[];
  tags?: string[];
}

interface CreateQuizBody {
  release_date: string; // "YYYY-MM-DD"
  questions: QuestionInput[];
}

Deno.serve(async (req) => {
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
  logStructured(requestId, "create_quiz_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const supabase = createServiceClient();

    // Verify admin role
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !user) {
      return errorResponse(ErrorCodes.NOT_AUTHORIZED, "User not found", requestId, 403);
    }

    const role = user.app_metadata?.role;
    if (role !== "admin") {
      return errorResponse(ErrorCodes.NOT_AUTHORIZED, "Admin access required", requestId, 403);
    }

    const body: CreateQuizBody = await req.json();
    const { release_date, questions } = body;

    // Validate inputs
    if (!release_date || !/^\d{4}-\d{2}-\d{2}$/.test(release_date)) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "release_date must be YYYY-MM-DD", requestId);
    }

    if (!questions || questions.length !== 10) {
      return errorResponse(ErrorCodes.VALIDATION_ERROR, "Exactly 10 questions required", requestId);
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.body?.trim()) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, `Question ${i + 1}: body is required`, requestId);
      }
      if (!q.answers || q.answers.length !== 4) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, `Question ${i + 1}: exactly 4 answers required`, requestId);
      }
      const correctCount = q.answers.filter((a) => a.is_correct).length;
      if (correctCount !== 1) {
        return errorResponse(ErrorCodes.VALIDATION_ERROR, `Question ${i + 1}: exactly 1 correct answer required`, requestId);
      }
      for (let j = 0; j < q.answers.length; j++) {
        if (!q.answers[j].body?.trim()) {
          return errorResponse(
            ErrorCodes.VALIDATION_ERROR,
            `Question ${i + 1}, Answer ${j + 1}: body is required`,
            requestId
          );
        }
      }
    }

    const releaseAtUtc = `${release_date}T11:30:00+00:00`;

    // Check for existing quiz on same date
    const { data: existingQuiz } = await supabase
      .from("quizzes")
      .select("id")
      .eq("release_at_utc", releaseAtUtc)
      .maybeSingle();

    if (existingQuiz) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        `A quiz is already scheduled for ${release_date}`,
        requestId
      );
    }

    // Insert questions
    const questionRows = questions.map((q) => ({ body: q.body.trim() }));
    const { data: insertedQuestions, error: qError } = await supabase
      .from("questions")
      .insert(questionRows)
      .select("id");

    if (qError || !insertedQuestions || insertedQuestions.length !== 10) {
      logStructured(requestId, "create_quiz_question_insert_error", { error: qError?.message });
      return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "Failed to insert questions", requestId, 500);
    }

    // Insert answers
    const answerRows: Array<{
      question_id: string;
      body: string;
      is_correct: boolean;
      sort_index: number;
    }> = [];

    for (let i = 0; i < questions.length; i++) {
      for (let j = 0; j < questions[i].answers.length; j++) {
        answerRows.push({
          question_id: insertedQuestions[i].id,
          body: questions[i].answers[j].body.trim(),
          is_correct: questions[i].answers[j].is_correct,
          sort_index: j,
        });
      }
    }

    const { error: aError } = await supabase.from("question_answers").insert(answerRows);
    if (aError) {
      logStructured(requestId, "create_quiz_answer_insert_error", { error: aError.message });
      return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "Failed to insert answers", requestId, 500);
    }

    // Insert tags
    const tagRows: Array<{ question_id: string; tag: string }> = [];
    for (let i = 0; i < questions.length; i++) {
      for (const tag of questions[i].tags || []) {
        if (tag.trim()) {
          tagRows.push({ question_id: insertedQuestions[i].id, tag: tag.trim().toLowerCase() });
        }
      }
    }
    if (tagRows.length > 0) {
      const { error: tError } = await supabase.from("question_tags").insert(tagRows);
      if (tError) {
        logStructured(requestId, "create_quiz_tag_insert_warning", { error: tError.message });
      }
    }

    // Create quiz
    const { data: quiz, error: quizError } = await supabase
      .from("quizzes")
      .insert({
        release_at_utc: releaseAtUtc,
        status: "draft",
      })
      .select("id, quiz_number, release_at_utc, status")
      .single();

    if (quizError || !quiz) {
      logStructured(requestId, "create_quiz_quiz_insert_error", { error: quizError?.message });
      return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "Failed to create quiz", requestId, 500);
    }

    // Link questions to quiz
    const qqRows = insertedQuestions.map((q, i) => ({
      quiz_id: quiz.id,
      question_id: q.id,
      order_index: i + 1,
    }));

    const { error: qqError } = await supabase.from("quiz_questions").insert(qqRows);
    if (qqError) {
      logStructured(requestId, "create_quiz_link_error", { error: qqError.message });
      return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "Failed to link questions to quiz", requestId, 500);
    }

    logStructured(requestId, "create_quiz_success", {
      quiz_id: quiz.id,
      quiz_number: quiz.quiz_number,
      release_date,
      question_count: 10,
      tag_count: tagRows.length,
    });

    return successResponse(
      {
        quiz_id: quiz.id,
        quiz_number: quiz.quiz_number,
        release_at_utc: quiz.release_at_utc,
        status: quiz.status,
        question_count: 10,
      },
      requestId
    );
  } catch (error) {
    logStructured(requestId, "create_quiz_error", { error: error.message });
    return errorResponse(ErrorCodes.SERVICE_UNAVAILABLE, "Internal server error", requestId, 500);
  }
});
