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
};

