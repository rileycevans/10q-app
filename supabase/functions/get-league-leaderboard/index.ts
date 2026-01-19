/**
 * Get League Leaderboard Edge Function
 * Returns leaderboard entries for a specific league with time windows, score types, and modes
 */

import { corsHeaders } from "../_shared/cors.ts";
import { successResponse, errorResponse, ErrorCodes } from "../_shared/response.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { generateRequestId, logStructured } from "../_shared/utils.ts";
import { getAuthenticatedUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  logStructured(requestId, "get_league_leaderboard_request", {});

  try {
    // Get authenticated user (required for league leaderboards)
    const authResult = await getAuthenticatedUser(req, requestId);
    if (authResult instanceof Response) {
      return authResult;
    }
    const userId = authResult.userId;

    // Parse query parameters
    const url = new URL(req.url);
    const leagueId = url.searchParams.get("league_id");
    const window = url.searchParams.get("window") || "7d";
    const mode = url.searchParams.get("mode") || "top";
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const count = parseInt(url.searchParams.get("count") || "12", 10);
    const scoreType = url.searchParams.get("score_type") || "cumulative";

    // Validate parameters
    if (!leagueId) {
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Missing league_id parameter",
        requestId,
        400
      );
    }

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

    const supabase = createServiceClient();

    // Verify league exists and user is a member
    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("id")
      .eq("id", leagueId)
      .single();

    if (leagueError || !league) {
      return errorResponse(
        ErrorCodes.LEAGUE_NOT_FOUND,
        "League not found",
        requestId,
        404
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("league_members")
      .select("player_id")
      .eq("league_id", leagueId)
      .eq("player_id", userId)
      .single();

    if (membershipError || !membership) {
      return errorResponse(
        ErrorCodes.NOT_A_MEMBER,
        "You are not a member of this league",
        requestId,
        403
      );
    }

    // Get all league member IDs
    const { data: leagueMembers, error: membersError } = await supabase
      .from("league_members")
      .select("player_id")
      .eq("league_id", leagueId);

    if (membersError || !leagueMembers || leagueMembers.length === 0) {
      return successResponse(
        {
          league_id: leagueId,
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

    const memberIds = leagueMembers.map((m) => m.player_id);

    // Get current quiz for "today" window
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

    // Query daily_scores filtered by league members and time window
    let query = supabase
      .from("daily_scores")
      .select(`
        player_id,
        quiz_id,
        score,
        total_time_ms,
        completed_at,
        players!inner(handle_display)
      `)
      .in("player_id", memberIds);

    // Apply time window filter
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
      logStructured(requestId, "get_league_leaderboard_query_error", {
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
      logStructured(requestId, "get_league_leaderboard_no_data", {
        window,
        league_id: leagueId,
      });
      return successResponse(
        {
          league_id: leagueId,
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

    // Aggregate by player
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

    // Calculate aggregated scores and rank
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

    // Sort and rank
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

    // Add ranks
    const rankedEntries = allEntries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));

    // Handle modes
    let entries = rankedEntries;
    let userRank: number | null = null;
    let userEntry: any = null;

    const userIndex = rankedEntries.findIndex((e) => e.player_id === userId);
    if (userIndex >= 0) {
      userRank = userIndex + 1;
      userEntry = rankedEntries[userIndex];
    }

    if (mode === "top") {
      entries = rankedEntries.slice(0, limit);
    } else {
      // Around-me mode
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

    logStructured(requestId, "get_league_leaderboard_success", {
      window,
      score_type: scoreType,
      mode,
      league_id: leagueId,
      entry_count: entries.length,
      user_rank: userRank,
    });

    return successResponse(
      {
        league_id: leagueId,
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
  } catch (error) {
    logStructured(requestId, "get_league_leaderboard_error", {
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

