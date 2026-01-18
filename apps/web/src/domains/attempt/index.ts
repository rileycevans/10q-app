import { edgeFunctions } from '@/lib/api/edge-functions';

export interface AttemptState {
  attempt_id: string;
  quiz_id: string;
  current_index: number;
  current_question_started_at: string | null;
  current_question_expires_at: string | null;
  state: 'IN_PROGRESS' | 'READY_TO_FINALIZE' | 'FINALIZED';
}

export interface AnswerResult {
  is_correct: boolean;
  base_points: number;
  bonus_points: number;
  total_points: number;
  next_index: number;
}

/**
 * Start or resume an attempt
 */
export async function startAttempt(quizId: string): Promise<AttemptState> {
  const response = await edgeFunctions.startAttempt(quizId);
  
  if (!response.ok || !response.data) {
    const errorMsg = response.error?.message || 'Failed to start attempt';
    const errorCode = response.error?.code;
    
    // Make 401/authentication errors more user-friendly
    // Check for various unauthorized error codes and messages
    if (errorCode === 'NOT_AUTHORIZED' ||
        errorMsg.toLowerCase().includes('401') ||
        errorMsg.toLowerCase().includes('authentication') ||
        errorMsg.toLowerCase().includes('authorization') ||
        errorMsg.toLowerCase().includes('sign in') ||
        errorMsg.toLowerCase().includes('not authorized')) {
      throw new Error('Please sign in to play. Click "Sign In" in the top-right corner.');
    }
    
    throw new Error(errorMsg);
  }

  const data = response.data;
  return {
    attempt_id: data.attempt_id,
    quiz_id: data.quiz_id,
    current_index: data.current_index,
    current_question_started_at: data.current_question_started_at || null,
    current_question_expires_at: data.current_question_expires_at || null,
    state: data.current_index === 11 ? 'READY_TO_FINALIZE' : 'IN_PROGRESS',
  };
}

/**
 * Resume an attempt (handles expiry automatically)
 */
export async function resumeAttempt(attemptId: string): Promise<AttemptState> {
  const response = await edgeFunctions.resumeAttempt(attemptId);
  
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to resume attempt');
  }

  const data = response.data;
  return {
    attempt_id: data.attempt_id,
    quiz_id: '', // Not returned by resume
    current_index: data.current_index,
    current_question_started_at: data.current_question_started_at || null,
    current_question_expires_at: data.current_question_expires_at || null,
    state: data.current_index === 11 ? 'READY_TO_FINALIZE' : 'IN_PROGRESS',
  };
}

/**
 * Submit an answer
 */
export async function submitAnswer(
  attemptId: string,
  questionId: string,
  selectedChoiceId: string
): Promise<AnswerResult> {
  const response = await edgeFunctions.submitAnswer(attemptId, questionId, selectedChoiceId);
  
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to submit answer');
  }

  const data = response.data;
  return {
    is_correct: data.is_correct,
    base_points: data.base_points,
    bonus_points: data.bonus_points,
    total_points: data.total_points,
    next_index: data.current_index,
  };
}

/**
 * Finalize an attempt
 */
export async function finalizeAttempt(attemptId: string): Promise<{ total_score: number }> {
  const response = await edgeFunctions.finalizeAttempt(attemptId);
  
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to finalize attempt');
  }

  return {
    total_score: response.data.total_score,
  };
}

/**
 * Get attempt results (for finalized attempts only)
 */
export interface QuestionResult {
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
}

export interface AttemptResults {
  attempt_id: string;
  quiz_id: string;
  finalized_at: string;
  total_score: number;
  total_time_ms: number;
  correct_count: number;
  questions: QuestionResult[];
}

export async function getAttemptResults(attemptId: string): Promise<AttemptResults> {
  const response = await edgeFunctions.getAttemptResults(attemptId);
  
  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch attempt results');
  }

  return {
    attempt_id: response.data.attempt_id,
    quiz_id: response.data.quiz_id,
    finalized_at: response.data.finalized_at,
    total_score: response.data.total_score,
    total_time_ms: response.data.total_time_ms,
    correct_count: response.data.correct_count,
    questions: response.data.questions,
  };
}

