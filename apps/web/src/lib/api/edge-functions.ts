import { supabase } from '@/lib/supabase/client';
import type { ErrorCode } from '@10q/contracts';

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;
  };
  request_id?: string;
}

const EDGE_FUNCTION_BASE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;

async function callEdgeFunction<T>(
  functionName: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    requireAuth?: boolean;
  } = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, requireAuth = false } = options;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (requireAuth) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return {
        ok: false,
        error: {
          code: 'NOT_AUTHORIZED' as ErrorCode,
          message: 'Authentication required',
        },
      };
    }
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${EDGE_FUNCTION_BASE_URL}/${functionName}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Try to parse error response
    try {
      const errorData = await response.json();
      // Always normalize 401 errors to UNAUTHORIZED for consistent handling
      if (response.status === 401) {
        return {
          ok: false,
          error: {
            code: 'NOT_AUTHORIZED' as ErrorCode,
            message: errorData.error?.message || 'Authentication required. Please sign in.',
          },
          request_id: errorData.request_id,
        };
      }
      return errorData;
    } catch {
      // If JSON parsing fails, return a generic error
      // Check for 401 specifically
      if (response.status === 401) {
        return {
          ok: false,
          error: {
            code: 'NOT_AUTHORIZED' as ErrorCode,
            message: 'Authentication required. Please sign in.',
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'SERVICE_UNAVAILABLE' as ErrorCode,
          message: `Server error: ${response.status} ${response.statusText}`,
        },
      };
    }
  }

  return response.json();
}

export const edgeFunctions = {
  getCurrentQuiz: () => callEdgeFunction<{ quiz_id: string; release_at_utc: string }>('get-current-quiz'),

  startAttempt: (quizId: string) =>
    callEdgeFunction<{
      attempt_id: string;
      quiz_id: string;
      current_index: number;
      current_question_started_at: string;
      current_question_expires_at: string;
      state: string;
    }>('start-attempt', {
      method: 'POST',
      body: { quiz_id: quizId },
      requireAuth: true,
    }),

  resumeAttempt: (attemptId: string) =>
    callEdgeFunction<{
      attempt_id: string;
      current_index: number;
      current_question_started_at: string | null;
      current_question_expires_at: string | null;
      state: string;
    }>(`resume-attempt?attempt_id=${encodeURIComponent(attemptId)}`, {
      method: 'GET',
      requireAuth: true,
    }),

  submitAnswer: (attemptId: string, questionId: string, selectedChoiceId: string) =>
    callEdgeFunction<{
      attempt_id: string;
      current_index: number;
      current_question_started_at: string | null;
      current_question_expires_at: string | null;
      is_correct: boolean;
      base_points: number;
      bonus_points: number;
      total_points: number;
      state: string;
    }>('submit-answer', {
      method: 'POST',
      body: {
        attempt_id: attemptId,
        question_id: questionId,
        selected_choice_id: selectedChoiceId,
      },
      requireAuth: true,
    }),

  finalizeAttempt: (attemptId: string) =>
    callEdgeFunction<{
      attempt_id: string;
      total_score: number;
      finalized_at: string;
    }>('finalize-attempt', {
      method: 'POST',
      body: { attempt_id: attemptId },
      requireAuth: true,
    }),

  getAttemptResults: (attemptId: string) =>
    callEdgeFunction<{
      attempt_id: string;
      quiz_id: string;
      finalized_at: string;
      total_score: number;
      total_time_ms: number;
      correct_count: number;
      questions: Array<{
        question_id: string;
        order_index: number;
        prompt: string;
        tags: string[];
        choices: Array<{
          id: string;
          text: string;
          order_index: number;
        }>;
        selected_choice_id: string | null;
        selected_choice_text: string | null;
        answer_kind: 'selected' | 'timeout';
        is_correct: boolean;
        time_ms: number;
        base_points: number;
        bonus_points: number;
        total_points: number;
      }>;
      daily_result: {
        quiz_id: string;
        player_id: string;
        completed_at: string;
        score: number;
        total_time_ms: number;
        correct_count: number;
      } | null;
    }>(`get-attempt-results?attempt_id=${encodeURIComponent(attemptId)}`, {
      method: 'GET',
      requireAuth: true,
    }),

  getGlobalLeaderboard: (params: {
    window: 'today' | '7d' | '30d' | '365d';
    mode: 'top' | 'around';
    limit?: number;
    count?: number;
    score_type?: 'cumulative' | 'average';
  }) => {
    const { window, mode, limit = 100, count = 12, score_type = 'cumulative' } = params;
    const queryParams = new URLSearchParams({
      window,
      mode,
      score_type,
      ...(mode === 'top' ? { limit: limit.toString() } : { count: count.toString() }),
    });
    return callEdgeFunction<{
      window: string;
      score_type: string;
      mode: string;
      entries: Array<{
        rank: number;
        player_id: string;
        handle_display: string;
        aggregated_score: number;
        attempt_count: number;
        total_time_ms: number;
        earliest_completed_at: string;
      }>;
      user_rank: number | null;
      user_entry: {
        rank: number;
        player_id: string;
        handle_display: string;
        aggregated_score: number;
        attempt_count: number;
        total_time_ms: number;
        earliest_completed_at: string;
      } | null;
      total_players: number;
    }>(`get-global-leaderboard?${queryParams.toString()}`, {
      method: 'GET',
      requireAuth: mode === 'around',
    });
  },

  getLeagueLeaderboard: (params: {
    league_id: string;
    window: 'today' | '7d' | '30d' | '365d';
    mode: 'top' | 'around';
    limit?: number;
    count?: number;
    score_type?: 'cumulative' | 'average';
  }) => {
    const { league_id, window, mode, limit = 100, count = 12, score_type = 'cumulative' } = params;
    const queryParams = new URLSearchParams({
      league_id,
      window,
      mode,
      score_type,
      ...(mode === 'top' ? { limit: limit.toString() } : { count: count.toString() }),
    });
    return callEdgeFunction<{
      league_id: string;
      window: string;
      score_type: string;
      mode: string;
      entries: Array<{
        rank: number;
        player_id: string;
        handle_display: string;
        aggregated_score: number;
        attempt_count: number;
        total_time_ms: number;
        earliest_completed_at: string;
      }>;
      user_rank: number | null;
      user_entry: {
        rank: number;
        player_id: string;
        handle_display: string;
        aggregated_score: number;
        attempt_count: number;
        total_time_ms: number;
        earliest_completed_at: string;
      } | null;
      total_players: number;
    }>(`get-league-leaderboard?${queryParams.toString()}`, {
      method: 'GET',
      requireAuth: true,
    });
  },

  createLeague: (name: string) =>
    callEdgeFunction<{
      league_id: string;
      name: string;
      owner_id: string;
      created_at: string;
    }>('create-league', {
      method: 'POST',
      body: { name },
      requireAuth: true,
    }),

  getMyLeagues: () =>
    callEdgeFunction<{
      leagues: Array<{
        league_id: string;
        name: string;
        owner_id: string;
        created_at: string;
        role: 'owner' | 'member';
        member_count: number;
        is_owner: boolean;
      }>;
    }>('get-my-leagues', {
      method: 'GET',
      requireAuth: true,
    }),

  getLeagueDetails: (leagueId: string) =>
    callEdgeFunction<{
      league_id: string;
      name: string;
      owner_id: string;
      created_at: string;
      is_owner: boolean;
      members: Array<{
        player_id: string;
        handle_display: string;
        role: 'owner' | 'member';
        created_at: string;
      }>;
    }>(`get-league-details?league_id=${encodeURIComponent(leagueId)}`, {
      method: 'GET',
      requireAuth: true,
    }),

  addLeagueMember: (leagueId: string, handle: string) =>
    callEdgeFunction<{
      player_id: string;
      handle_display: string;
      role: 'member';
    }>('add-league-member', {
      method: 'POST',
      body: { league_id: leagueId, handle },
      requireAuth: true,
    }),

  removeLeagueMember: (leagueId: string, playerId: string) =>
    callEdgeFunction<{
      success: boolean;
    }>('remove-league-member', {
      method: 'POST',
      body: { league_id: leagueId, player_id: playerId },
      requireAuth: true,
    }),

  deleteLeague: (leagueId: string) =>
    callEdgeFunction<{
      success: boolean;
    }>('delete-league', {
      method: 'POST',
      body: { league_id: leagueId },
      requireAuth: true,
    }),
};

