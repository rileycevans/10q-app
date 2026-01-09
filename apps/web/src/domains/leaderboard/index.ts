/**
 * Leaderboard domain adapter
 * Provides typed interfaces for leaderboard operations
 */

import { edgeFunctions } from '@/lib/api/edge-functions';

export type LeaderboardWindow = 'today' | '7d' | '30d' | '365d';
export type LeaderboardMode = 'top' | 'around';
export type ScoreType = 'cumulative' | 'average';

export interface LeaderboardEntry {
  rank: number;
  player_id: string;
  handle_display: string;
  aggregated_score: number;
  attempt_count: number;
  total_time_ms: number;
  earliest_completed_at: string;
}

export interface GlobalLeaderboardResponse {
  window: string;
  score_type: string;
  mode: string;
  entries: LeaderboardEntry[];
  user_rank: number | null;
  user_entry: LeaderboardEntry | null;
  total_players: number;
}

export interface LeagueLeaderboardResponse {
  league_id: string;
  window: string;
  score_type: string;
  mode: string;
  entries: LeaderboardEntry[];
  user_rank: number | null;
  user_entry: LeaderboardEntry | null;
  total_players: number;
}

/**
 * Get global leaderboard
 */
export async function getGlobalLeaderboard(params: {
  window: LeaderboardWindow;
  mode: LeaderboardMode;
  limit?: number;
  count?: number;
  score_type?: ScoreType;
}): Promise<GlobalLeaderboardResponse> {
  const response = await edgeFunctions.getGlobalLeaderboard(params);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch global leaderboard');
  }

  return response.data;
}

/**
 * Get league leaderboard
 */
export async function getLeagueLeaderboard(params: {
  league_id: string;
  window: LeaderboardWindow;
  mode: LeaderboardMode;
  limit?: number;
  count?: number;
  score_type?: ScoreType;
}): Promise<LeagueLeaderboardResponse> {
  const response = await edgeFunctions.getLeagueLeaderboard(params);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch league leaderboard');
  }

  return response.data;
}

// Re-export types for convenience
export type { LeagueLeaderboardResponse };

