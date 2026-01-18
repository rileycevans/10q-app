import { supabase } from '@/lib/supabase/client';
import type { ErrorCode } from '@10q/contracts';
import { withRetry, getUserFriendlyErrorMessage } from '@/lib/error-handling';
import { logger } from '@/lib/logger';

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
    retry?: boolean;
  } = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, requireAuth = false, retry = true } = options;

  const performRequest = async (): Promise<ApiResponse<T>> => {
    const requestId = logger.generateRequestId();
    const startTime = Date.now();
    
    logger.info({
      event: 'NETWORK_REQUEST_START',
      scope: 'network',
      request_id: requestId,
      method,
      endpoint: functionName,
    });

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (requireAuth) {
      // Get session - Supabase client auto-refreshes expired tokens
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        logger.error({
          event: 'ERROR',
          scope: 'auth',
          request_id: requestId,
          error_name: 'SessionError',
          error_message: sessionError.message,
          context: { endpoint: functionName },
        });
        return {
          ok: false,
          error: {
            code: 'NOT_AUTHORIZED' as ErrorCode,
            message: 'Session error. Please sign in again.',
          },
          request_id: requestId,
        };
      }
      
      if (!session) {
        logger.warn({
          event: 'AUTH_REQUIRED',
          scope: 'auth',
          request_id: requestId,
          reason: 'no_session',
          context: { endpoint: functionName },
        });
        return {
          ok: false,
          error: {
            code: 'NOT_AUTHORIZED' as ErrorCode,
            message: 'Authentication required. Please sign in.',
          },
          request_id: requestId,
        };
      }
      
      if (!session.access_token) {
        logger.warn({
          event: 'AUTH_REQUIRED',
          scope: 'auth',
          request_id: requestId,
          reason: 'no_access_token',
          context: { endpoint: functionName },
        });
        return {
          ok: false,
          error: {
            code: 'NOT_AUTHORIZED' as ErrorCode,
            message: 'Authentication required. Please sign in.',
          },
          request_id: requestId,
        };
      }
      
      // Check if token is expired (expires_at is in seconds since epoch)
      if (session.expires_at) {
        const expiresAt = session.expires_at * 1000; // Convert to milliseconds
        const now = Date.now();
        const expiresIn = expiresAt - now;
        
        if (expiresIn <= 0) {
          // Token is expired, try to refresh
          logger.info({
            event: 'TOKEN_REFRESH_START',
            scope: 'auth',
            request_id: requestId,
            reason: 'token_expired',
          });
          
          const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession();
          
          if (refreshError || !refreshedSession?.access_token) {
            logger.error({
              event: 'TOKEN_REFRESH_FAILED',
              scope: 'auth',
              request_id: requestId,
              error_name: refreshError?.name || 'RefreshError',
              error_message: refreshError?.message || 'No refreshed session',
            });
            return {
              ok: false,
              error: {
                code: 'NOT_AUTHORIZED' as ErrorCode,
                message: 'Session expired. Please sign in again.',
              },
              request_id: requestId,
            };
          }
          
          headers['Authorization'] = `Bearer ${refreshedSession.access_token}`;
          logger.debug({
            event: 'TOKEN_REFRESHED',
            scope: 'auth',
            request_id: requestId,
            token_length: refreshedSession.access_token.length,
          });
        } else {
          headers['Authorization'] = `Bearer ${session.access_token}`;
          logger.debug({
            event: 'TOKEN_VALID',
            scope: 'auth',
            request_id: requestId,
            expires_in_seconds: Math.round(expiresIn / 1000),
          });
        }
      } else {
        // No expiry info, use token as-is
        headers['Authorization'] = `Bearer ${session.access_token}`;
        logger.debug({
          event: 'TOKEN_USED',
          scope: 'auth',
          request_id: requestId,
          token_length: session.access_token.length,
          reason: 'no_expiry_info',
        });
      }
    }

    const response = await fetch(`${EDGE_FUNCTION_BASE_URL}/${functionName}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const durationMs = Date.now() - startTime;
    const responseData = await response.json();

    if (!response.ok) {
      const errorData = responseData as ApiResponse<T>;
      const errorCode = errorData.error?.code || 'SERVICE_UNAVAILABLE';
      const errorMessage = errorData.error?.message || response.statusText;
      
      // Classify error type
      let errorClassification = 'unknown';
      if (response.status === 401 || response.status === 403) {
        errorClassification = '401';
      } else if (response.status >= 500) {
        errorClassification = '500';
      } else if (response.status === 408 || response.status === 504) {
        errorClassification = 'timeout';
      } else if (response.status === 429) {
        errorClassification = 'rate_limit';
      } else if (response.status >= 400 && response.status < 500) {
        errorClassification = 'validation';
      }

      logger.error({
        event: 'NETWORK_REQUEST_COMPLETE',
        scope: 'network',
        request_id: requestId,
        method,
        endpoint: functionName,
        status: response.status,
        duration_ms: durationMs,
        error_code: errorCode,
        error_classification: errorClassification,
        context: {
          error_message: errorMessage,
        },
      });

      // Always normalize 401 errors to UNAUTHORIZED for consistent handling
      if (response.status === 401) {
        const error: ApiResponse<T> = {
          ok: false,
          error: {
            code: 'NOT_AUTHORIZED' as ErrorCode,
            message: errorMessage || 'Authentication required. Please sign in.',
          },
          request_id: errorData.request_id || requestId,
        };
        // Add status for retry logic
        (error as any).status = response.status;
        throw error;
      }
      
      const error: ApiResponse<T> = errorData;
      (error as any).status = response.status;
      throw error;
    }

    logger.info({
      event: 'NETWORK_REQUEST_COMPLETE',
      scope: 'network',
      request_id: requestId,
      method,
      endpoint: functionName,
      status: response.status,
      duration_ms: durationMs,
    });

    return responseData;
  };

  // Apply retry logic for network errors and retryable status codes
  if (retry) {
    try {
      return await withRetry(performRequest, {
        retryableStatusCodes: [408, 429, 500, 502, 503, 504],
        retryableErrorCodes: ['SERVICE_UNAVAILABLE'],
      });
    } catch (error: any) {
      // If retry exhausted, enhance error message
      if (error.error) {
        error.error.message = getUserFriendlyErrorMessage(error.error, error.status);
      }
      
      // Log retry exhaustion
      logger.error({
        event: 'NETWORK_RETRY_EXHAUSTED',
        scope: 'network',
        request_id: error.request_id,
        endpoint: functionName,
        error_code: error.error?.code,
        status: error.status,
      });
      
      throw error;
    }
  }

  return performRequest();
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

  updateHandle: (handle: string) =>
    callEdgeFunction<{
      handle_display: string;
      handle_canonical: string;
      handle_last_changed_at: string;
    }>('update-handle', {
      method: 'POST',
      body: { handle },
      requireAuth: true,
    }),

  getProfileByHandle: (handle: string) =>
    callEdgeFunction<{
      player_id: string;
      handle_display: string;
      handle_canonical: string;
      created_at: string;
      stats: {
        all_time_best: number | null;
        all_time_worst: number | null;
        total_games: number;
        average_score: number | null;
      };
      recent_results: Array<{
        score: number;
        correct_count: number;
        completed_at: string;
      }>;
      category_performance: Array<{
        category: string;
        total_questions: number;
        correct_count: number;
        accuracy: number;
        average_score: number;
        best_score: number;
      }>;
    }>(`get-profile-by-handle?handle=${encodeURIComponent(handle)}`, {
      method: 'GET',
      requireAuth: false, // Public profile page
    }),
};

