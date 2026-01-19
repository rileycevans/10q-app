/**
 * Get Global Leaderboard Edge Function (Standalone - all shared code inlined)
 */

// Inline CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inline Error Codes
const ErrorCodes = {
  ATTEMPT_ALREADY_COMPLETED: "ATTEMPT_ALREADY_COMPLETED",
  ATTEMPT_NOT_FOUND: "ATTEMPT_NOT_FOUND",
  ATTEMPT_ALREADY_EXISTS: "ATTEMPT_ALREADY_EXISTS",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  QUESTION_ALREADY_ANSWERED: "QUESTION_ALREADY_ANSWERED",
  QUESTION_EXPIRED: "QUESTION_EXPIRED",
  QUESTION_NOT_FOUND: "QUESTION_NOT_FOUND",
  QUIZ_NOT_AVAILABLE: "QUIZ_NOT_AVAILABLE",
  QUIZ_NOT_FOUND: "QUIZ_NOT_FOUND",
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  NOT_A_MEMBER: "NOT_A_MEMBER",
  LEAGUE_NOT_FOUND: "LEAGUE_NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NO_VIEWER_SCORE: "NO_VIEWER_SCORE",
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
  status: number = 400,
  details?: unknown
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        details,
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

// Inline auth helper
async function getAuthenticatedUser(
  request: Request,
  requestId: string
): Promise<{ userId: string } | Response> {
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Missing Authorization header",
      requestId,
      401
    );
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.39.0");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  
  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return errorResponse(
      ErrorCodes.NOT_AUTHORIZED,
      "Invalid or expired token",
      requestId,
      401
    );
  }

  return { userId: user.id };
}

// Main function
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  logStructured(requestId, "get_global_leaderboard_request", {});

  try {
    const authResult = await getAuthenticatedUser(req, requestId);
    const userId = authResult instanceof Response ? null : authResult.userId;

    const url = new URL(req.url);
    const window = url.searchParams.get("window") || "7d";
    const mode = url.searchParams.get("mode") || "top";
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const count = parseInt(url.searchParams.get("count") || "12", 10);
    const scoreType = url.searchParams.get("score_type") || "cumulative";

    if (!["today", "7d", "30d", "365d"].includes(window)) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid window. Must be: today, 7d, 30d, or 365d",
        requestId,
        400
      );
    }

    if (!["top", "around"].includes(mode)) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid mode. Must be: top or around",
        requestId,
        400
      );
    }

    if (!["cumulative", "average"].includes(scoreType)) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid score_type. Must be: cumulative or average",
        requestId,
        400
      );
    }

    if (mode === "around" && !userId) {
      return errorResponse(
        ErrorCodes.NOT_AUTHORIZED,
        "Authentication required for around-me mode",
        requestId,
        401
      );
    }

    const supabase = await createServiceClient();

    let currentQuizId: string | null = null;
    if (window === "today") {
      const { data: currentQuiz } = await supabase
        .from("quizzes")
        .select("id")
        .eq("status", "published")
        .lte("release_at_utc", new Date().toISOString())
        .order("release_at_utc", { ascending: false })
        .limit(1)
        .single();

      if (!currentQuiz) {
        return errorResponse(
          ErrorCodes.QUIZ_NOT_AVAILABLE,
          "No quiz available for today",
          requestId,
          503
        );
      }

      currentQuizId = currentQuiz.id;
    }

    let query = supabase
      .from("daily_scores")
      .select(`
        player_id,
        quiz_id,
        score,
        total_time_ms,
        completed_at,
        players!inner(handle_display)
      `);

    if (window === "today") {
      query = query.eq("quiz_id", currentQuizId!);
    } else {
      const days = window === "7d" ? 7 : window === "30d" ? 30 : 365;
      const cutoffDate = new Date();
      cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days);
      query = query.gte("completed_at", cutoffDate.toISOString());
    }

    const { data: dailyResults, error: drError } = await query;

    if (drError) {
      logStructured(requestId, "get_global_leaderboard_query_error", {
        error: drError.message,
      });
      return errorResponse(
        ErrorCodes.SERVICE_UNAVAILABLE,
        "Failed to query leaderboard",
        requestId,
        500
      );
    }

    if (!dailyResults || dailyResults.length === 0) {
      logStructured(requestId, "get_global_leaderboard_no_data", { window });
      return successResponse(
        {
          window,
          score_type: scoreType,
          mode,
          entries: [],
          user_rank: null,
          user_entry: null,
          total_players: 0,
        },
        requestId
      );
    }

    const playerMap = new Map();
    for (const result of dailyResults) {
      const playerId = result.player_id;
      const handleDisplay = (result.players as any)?.handle_display || "Unknown";
      
      if (!playerMap.has(playerId)) {
        playerMap.set(playerId, {
          player_id: playerId,
          handle_display: handleDisplay,
          scores: [],
          total_time_ms: 0,
          completed_ats: [],
        });
      }

      const player = playerMap.get(playerId)!;
      player.scores.push(Number(result.score));
      player.total_time_ms += result.total_time_ms;
      player.completed_ats.push(new Date(result.completed_at));
    }

    const allEntries = Array.from(playerMap.values()).map((player) => {
      const aggregatedScore =
        scoreType === "cumulative"
          ? player.scores.reduce((a: number, b: number) => a + b, 0)
          : player.scores.reduce((a: number, b: number) => a + b, 0) / player.scores.length;

      return {
        player_id: player.player_id,
        handle_display: player.handle_display,
        aggregated_score: aggregatedScore,
        total_time_ms: player.total_time_ms,
        attempt_count: player.scores.length,
        earliest_completed_at: new Date(
          Math.min(...player.completed_ats.map((d: Date) => d.getTime()))
        ).toISOString(),
      };
    });

    allEntries.sort((a, b) => {
      if (b.aggregated_score !== a.aggregated_score) {
        return b.aggregated_score - a.aggregated_score;
      }
      if (a.total_time_ms !== b.total_time_ms) {
        return a.total_time_ms - b.total_time_ms;
      }
      if (a.earliest_completed_at !== b.earliest_completed_at) {
        return a.earliest_completed_at.localeCompare(b.earliest_completed_at);
      }
      return a.player_id.localeCompare(b.player_id);
    });

    const rankedEntries = allEntries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

    let entries = rankedEntries;
    let userRank: number | null = null;
    let userEntry: any = null;

    if (userId) {
      const userIndex = rankedEntries.findIndex((e) => e.player_id === userId);
      if (userIndex >= 0) {
        userRank = userIndex + 1;
        userEntry = rankedEntries[userIndex];
      }
    }

    if (mode === "top") {
      entries = rankedEntries.slice(0, limit);
    } else {
      if (!userRank) {
        return errorResponse(
          ErrorCodes.NO_VIEWER_SCORE,
          "User has no score in this time window",
          requestId,
          404
        );
      }

      if (userRank <= 6) {
        entries = rankedEntries.slice(0, 12);
      } else {
        const start = Math.max(0, userRank - 6);
        const end = Math.min(rankedEntries.length, userRank + 5);
        entries = rankedEntries.slice(start, end);
      }
    }

    logStructured(requestId, "get_global_leaderboard_success", {
      window,
      score_type: scoreType,
      mode,
      entry_count: entries.length,
      user_rank: userRank,
    });

    return successResponse(
      {
        window,
        score_type: scoreType,
        mode,
        entries: entries.map((e) => ({
          rank: e.rank,
          player_id: e.player_id,
          handle_display: e.handle_display,
          aggregated_score: Number(e.aggregated_score.toFixed(2)),
          attempt_count: e.attempt_count,
          total_time_ms: e.total_time_ms,
          earliest_completed_at: e.earliest_completed_at,
        })),
        user_rank: userRank,
        user_entry: userEntry
          ? {
              rank: userEntry.rank,
              player_id: userEntry.player_id,
              handle_display: userEntry.handle_display,
              aggregated_score: Number(userEntry.aggregated_score.toFixed(2)),
              attempt_count: userEntry.attempt_count,
              total_time_ms: userEntry.total_time_ms,
              earliest_completed_at: userEntry.earliest_completed_at,
            }
          : null,
        total_players: rankedEntries.length,
      },
      requestId
    );
  } catch (error: any) {
    logStructured(requestId, "get_global_leaderboard_error", {
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

