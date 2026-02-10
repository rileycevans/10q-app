/**
 * Attempt Domain Layer
 * Follows Notion Backend & Data Model (V1) specification
 */

import { edgeFunctions } from '@/lib/api/edge-functions';

// Types following Notion plan
export interface AttemptState {
  attempt_id: string;
  quiz_id: string;
  current_index: number;
  current_question_started_at: string | null;
  current_question_expires_at: string | null;
  state: 'IN_PROGRESS' | 'READY_TO_FINALIZE' | 'FINALIZED';
}

export interface AnswerResult {
  attempt_id: string;
  question_id: string;
  is_correct: boolean;
  base_points: number;
  bonus_points: number;
  total_points: number;
  time_ms: number;
  next_question: Record<string, unknown> | null;
  current_index: number;
  question_started_at: string | null;
  question_expires_at: string | null;
}

export interface QuestionResult {
  question_id: string;
  order_index: number;
  body: string; // Notion plan: body instead of prompt
  tags: string[];
  answers: Array<{ // Notion plan: answers instead of choices
    id: string;
    body: string; // Notion plan: body instead of text
    sort_index: number; // Notion plan: sort_index
    is_correct: boolean;
  }>;
  selected_answer_id: string | null; // Notion plan: answer instead of choice
  selected_answer_body: string | null;
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
  daily_score: { // Notion plan: daily_score instead of daily_result
    quiz_id: string;
    player_id: string;
    completed_at: string;
    score: number;
    total_time_ms: number;
    correct_count: number;
  } | null;
}

/**
 * Start or resume an attempt for a quiz
 */
export async function startAttempt(quizId: string): Promise<AttemptState> {
  const response = await edgeFunctions.startAttempt(quizId);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to start attempt');
  }

  const data = response.data;

  // Determine state based on current_index
  let state: AttemptState['state'] = 'IN_PROGRESS';
  if (data.state === 'FINALIZED') {
    state = 'FINALIZED';
  } else if (data.current_index > 10) {
    state = 'READY_TO_FINALIZE';
  }

  return {
    attempt_id: data.attempt_id,
    quiz_id: data.quiz_id,
    current_index: data.current_index,
    current_question_started_at: data.current_question_started_at,
    current_question_expires_at: data.current_question_expires_at,
    state,
  };
}

/**
 * Resume an attempt (handles expired questions)
 */
export async function resumeAttempt(attemptId: string): Promise<AttemptState> {
  const response = await edgeFunctions.resumeAttempt(attemptId);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to resume attempt');
  }

  const data = response.data;

  // Determine state
  let state: AttemptState['state'] = 'IN_PROGRESS';
  if (data.state === 'FINALIZED') {
    state = 'FINALIZED';
  } else if (data.current_index > 10) {
    state = 'READY_TO_FINALIZE';
  }

  return {
    attempt_id: data.attempt_id,
    quiz_id: '', // Not returned by resume
    current_index: data.current_index,
    current_question_started_at: data.current_question_started_at,
    current_question_expires_at: data.current_question_expires_at,
    state,
  };
}

/**
 * Submit an answer for a question
 * Note: Uses selected_answer_id per Notion plan (not selected_choice_id)
 */
export async function submitAnswer(
  attemptId: string,
  questionId: string,
  selectedAnswerId: string
): Promise<AnswerResult> {
  const response = await edgeFunctions.submitAnswer(attemptId, questionId, selectedAnswerId);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to submit answer');
  }

  return {
    attempt_id: response.data.attempt_id,
    question_id: questionId,
    is_correct: response.data.is_correct,
    base_points: response.data.base_points,
    bonus_points: response.data.bonus_points,
    total_points: response.data.total_points,
    time_ms: response.data.time_ms,
    next_question: response.data.next_question,
    current_index: response.data.current_index,
    question_started_at: response.data.question_started_at,
    question_expires_at: response.data.question_expires_at,
  };
}

/**
 * Finalize an attempt
 */
export async function finalizeAttempt(attemptId: string): Promise<{
  attempt_id: string;
  total_score: number;
  finalized_at: string;
}> {
  const response = await edgeFunctions.finalizeAttempt(attemptId);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to finalize attempt');
  }

  return {
    attempt_id: response.data.attempt_id,
    total_score: response.data.total_score,
    finalized_at: response.data.finalized_at,
  };
}

/**
 * Get detailed results for a finalized attempt
 */
export async function getAttemptResults(attemptId: string): Promise<AttemptResults> {
  const response = await edgeFunctions.getAttemptResults(attemptId);

  if (!response.ok || !response.data) {
    throw new Error(response.error?.message || 'Failed to get attempt results');
  }

  return response.data as AttemptResults;
}
