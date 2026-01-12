/**
 * Get Profile By Handle Edge Function (Standalone)
 * Returns public profile information by handle (no auth required)
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inline Error Codes
const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

// Inline response helpers
function successResponse<T>(data: T, requestId: string): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      data,
      request_id: requestId,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
      status: 200,
    }
  );
}

function errorResponse(
  code: string,
  message: string,
  requestId: string,
  status: number = 400
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
      },
      request_id: requestId,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
      status,
    }
  );
}

// Inline utils
function generateRequestId(): string {
  return crypto.randomUUID();
}

function logStructured(
  requestId: string,
  eventType: string,
  data: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      request_id: requestId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
      ...data,
    })
  );
}

function canonicalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

// Inline Supabase client
async function createServiceClient() {
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Main function
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  logStructured(requestId, "get_profile_by_handle_request", {});

  try {
    const url = new URL(req.url);
    const handle = url.searchParams.get("handle");

    if (!handle) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "handle parameter is required",
        requestId,
        400
      );
    }

    const handleCanonical = canonicalizeHandle(handle);
    const supabase = await createServiceClient();

    // Get profile by handle
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, handle_display, handle_canonical, created_at")
      .eq("handle_canonical", handleCanonical)
      .single();

    if (profileError || !profile) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Profile not found",
        requestId,
        404
      );
    }

    // Get stats from daily_results
    const { data: results, error: resultsError } = await supabase
      .from("daily_results")
      .select("score, correct_count, completed_at")
      .eq("player_id", profile.id)
      .order("completed_at", { ascending: false });

    if (resultsError) {
      logStructured(requestId, "get_profile_stats_error", {
        error: resultsError.message,
      });
    }

    const scores = (results || []).map((r: any) => Number(r.score));
    const allTimeBest = scores.length > 0 ? Math.max(...scores) : null;
    const allTimeWorst = scores.length > 0 ? Math.min(...scores) : null;
    const totalGames = scores.length;
    const averageScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null;

    // Get recent results (last 10)
    const recentResults = (results || []).slice(0, 10).map((r: any) => ({
      score: Number(r.score),
      correct_count: r.correct_count,
      completed_at: r.completed_at,
    }));

    // Get category performance
    // First, get all attempt IDs for this player
    const { data: attempts, error: attemptsError } = await supabase
      .from("attempts")
      .select("id")
      .eq("player_id", profile.id);

    let categoryPerformance: Array<{
      category: string;
      total_questions: number;
      correct_count: number;
      accuracy: number;
      average_score: number;
      best_score: number;
    }> = [];

    if (!attemptsError && attempts && attempts.length > 0) {
      const attemptIds = attempts.map((a: any) => a.id);

      // Get all attempt_answers for this player
      const { data: answers, error: answersError } = await supabase
        .from("attempt_answers")
        .select("is_correct, base_points, bonus_points, question_id")
        .in("attempt_id", attemptIds);

      if (!answersError && answers && answers.length > 0) {
        // Get unique question IDs
        const questionIds = [...new Set(answers.map((a: any) => a.question_id))];

        // Query questions with their tags
        const { data: questions, error: questionsError } = await supabase
          .from("questions")
          .select(`
            id,
            question_tags (
              tag
            )
          `)
          .in("id", questionIds);

        // Process category performance
        const categoryStatsMap = new Map<string, {
          total_questions: number;
          correct_count: number;
          total_points: number;
          best_score: number;
        }>();

        if (!questionsError && questions) {
          // Create a map of question_id -> tags
          const questionTagsMap = new Map<string, string[]>();
          for (const question of questions) {
            const tags = (question.question_tags || []).map((t: any) => t.tag).filter(Boolean);
            questionTagsMap.set(question.id, tags);
          }

          // Aggregate by category
          for (const answer of answers) {
            const tags = questionTagsMap.get(answer.question_id) || [];
            const totalPoints = Number(answer.base_points) + Number(answer.bonus_points);

            for (const tag of tags) {
              if (!tag) continue;

              if (!categoryStatsMap.has(tag)) {
                categoryStatsMap.set(tag, {
                  total_questions: 0,
                  correct_count: 0,
                  total_points: 0,
                  best_score: 0,
                });
              }

              const stats = categoryStatsMap.get(tag)!;
              stats.total_questions += 1;
              if (answer.is_correct) {
                stats.correct_count += 1;
              }
              stats.total_points += totalPoints;
              stats.best_score = Math.max(stats.best_score, totalPoints);
            }
          }
        }

      // Convert map to array format
      categoryPerformance = Array.from(categoryStatsMap.entries()).map(([category, stats]) => ({
        category,
        total_questions: stats.total_questions,
        correct_count: stats.correct_count,
        accuracy: stats.total_questions > 0 
          ? Number((stats.correct_count / stats.total_questions * 100).toFixed(1))
          : 0,
        average_score: stats.total_questions > 0
          ? Number((stats.total_points / stats.total_questions).toFixed(2))
          : 0,
        best_score: stats.best_score,
      })).sort((a, b) => b.total_questions - a.total_questions); // Sort by most questions answered
    }

    logStructured(requestId, "get_profile_by_handle_success", {
      handle: handleCanonical,
      total_games: totalGames,
      category_count: categoryPerformance.length,
    });

    return successResponse(
      {
        player_id: profile.id,
        handle_display: profile.handle_display,
        handle_canonical: profile.handle_canonical,
        created_at: profile.created_at,
        stats: {
          all_time_best: allTimeBest,
          all_time_worst: allTimeWorst,
          total_games: totalGames,
          average_score: averageScore ? Number(averageScore.toFixed(2)) : null,
        },
        recent_results: recentResults,
        category_performance: categoryPerformance,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "get_profile_by_handle_error", {
      error: error.message,
    });
    return errorResponse(
      ErrorCodes.SERVICE_UNAVAILABLE,
      "Internal server error",
      requestId,
      500
    );
  }
});

