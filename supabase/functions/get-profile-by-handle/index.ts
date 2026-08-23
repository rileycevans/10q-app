/**
 * Get Profile By Handle Edge Function (Standalone)
 * Returns public profile information by handle (no auth required)
 */

import { corsHeaders, corsHeadersFor } from "../_shared/cors.ts";

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
/**
 * C7 — mirrors public.is_streak_alive(). A streak is live only if the player
 * finalized today's or yesterday's quiz; yesterday counts because today's quiz
 * drops at 11:30 UTC and may not have been played yet.
 */
function isStreakAlive(lastQuizDate: string | null | undefined): boolean {
  if (!lastQuizDate) return false;
  const last = new Date(`${String(lastQuizDate).slice(0, 10)}T00:00:00.000Z`);
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const diffDays = Math.round((todayUtc.getTime() - last.getTime()) / 86400000);
  return diffDays <= 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(req) });
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

    // Throttle before doing any work. This endpoint is unauthenticated,
    // service-role, and a heavy multi-join measured at 2.27s per call — the
    // cheapest way to load the database here. It is also the enumeration
    // path now that handles are guessable across a ~250k space.
    //
    // 30 per minute is far above what a person browsing profiles does and
    // far below what walking the handle space needs. Fails open: a throttle
    // that takes the endpoint down when it breaks is worse than the abuse.
    const supabase = await createServiceClient();
    try {
      const forwarded = req.headers.get("x-forwarded-for");
      const callerKey =
        (forwarded ? forwarded.split(",")[0]?.trim() : null) ??
        req.headers.get("cf-connecting-ip") ??
        "unknown";

      const { data: allowed, error: limitError } = await supabase.rpc(
        "check_rate_limit",
        {
          p_bucket_key: callerKey,
          p_endpoint: "get-profile-by-handle",
          p_limit: 30,
          p_window_seconds: 60,
        },
      );

      if (!limitError && allowed === false) {
        logStructured(requestId, "get_profile_by_handle_rate_limited", {
          caller: callerKey,
        });
        return errorResponse(
          ErrorCodes.SERVICE_UNAVAILABLE,
          "Too many requests. Please slow down and try again shortly.",
          requestId,
          429,
        );
      }
    } catch {
      // Fail open.
    }

    // Get profile by handle
    const { data: profile, error: profileError } = await supabase
      .from("players")
      // C7: last_quiz_date comes along so the streak can be expired below.
      // players.current_streak is the value as of the last finalize and never
      // decays, so a player who stopped in April still showed a live streak.
      .select("id, public_id, handle_display, handle_canonical, created_at, current_streak, longest_streak, last_quiz_date")
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

    // Get stats from daily_scores
    const { data: results, error: resultsError } = await supabase
      .from("daily_scores")
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
    const perfectGames = (results || []).filter(
      (r: any) => Number(r.correct_count) === 10
    ).length;

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

    let overallAccuracy: number | null = null;
    let avgTimePerQuestionMs: number | null = null;

    if (!attemptsError && attempts && attempts.length > 0) {
      const attemptIds = attempts.map((a: any) => a.id);

      // Get all attempt_answers for this player
      const { data: answers, error: answersError } = await supabase
        .from("attempt_answers")
        .select("is_correct, base_points, bonus_points, question_id, time_ms")
        .in("attempt_id", attemptIds);

      if (!answersError && answers && answers.length > 0) {
        const totalAnswers = answers.length;
        const correctAnswers = answers.filter((a: any) => a.is_correct).length;
        overallAccuracy = Number(((correctAnswers / totalAnswers) * 100).toFixed(1));
        const totalTimeMs = answers.reduce(
          (sum: number, a: any) => sum + Number(a.time_ms ?? 0),
          0
        );
        avgTimePerQuestionMs = Math.round(totalTimeMs / totalAnswers);

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
    }

    logStructured(requestId, "get_profile_by_handle_success", {
      handle: handleCanonical,
      total_games: totalGames,
      category_count: categoryPerformance.length,
    });

    return successResponse(
      {
        // NOT profile.id. That is the auth user id — a stable cross-session
        // identifier, the join key across every table, and the subject of
        // every RLS policy — and this endpoint is unauthenticated, so it was
        // handed to anyone holding the publishable key. public_id identifies
        // the player without being any of those things.
        //
        // The field keeps its name and shape: store binaries stay installed
        // for months and the client compares this value to decide whether to
        // show a Report button (CLAUDE.md rule 5 — never remove or repurpose
        // a field).
        player_id: profile.public_id,
        handle_display: profile.handle_display,
        handle_canonical: profile.handle_canonical,
        created_at: profile.created_at,
        stats: {
          all_time_best: allTimeBest,
          all_time_worst: allTimeWorst,
          total_games: totalGames,
          average_score: averageScore ? Number(averageScore.toFixed(2)) : null,
          perfect_games: perfectGames,
          overall_accuracy: overallAccuracy,
          avg_time_per_question_ms: avgTimePerQuestionMs,
        },
        streaks: {
          current_streak: isStreakAlive(profile.last_quiz_date)
            ? (profile.current_streak ?? 0)
            : 0,
          longest_streak: profile.longest_streak ?? 0,
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

