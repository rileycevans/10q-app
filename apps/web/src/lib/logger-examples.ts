/**
 * Example usage of the structured logger
 * These are examples - not actual code to run
 */

import { logger, hashUserId } from './logger';

// Example 1: Logging a quiz attempt flow
export function exampleQuizFlow() {
  const actionId = logger.generateActionId();
  const attemptId = 'attempt-123';
  const quizId = 'quiz-456';
  const questionId = 'question-789';

  // Quiz loaded
  logger.info({
    event: 'QUIZ_LOADED',
    scope: 'quiz',
    action_id: actionId,
    quiz_id: quizId,
    question_count: 10,
    server_ts: new Date().toISOString(),
  });

  // Question shown
  logger.info({
    event: 'QUESTION_SHOWN',
    scope: 'quiz',
    action_id: actionId,
    question_index: 0,
    question_id: questionId,
    attempt_id: attemptId,
  });

  // Answer selected
  logger.info({
    event: 'ANSWER_SELECTED',
    scope: 'quiz',
    action_id: actionId,
    question_id: questionId,
    selected_choice_id: 'choice-abc',
    attempt_id: attemptId,
    client_ts: new Date().toISOString(),
  });

  // Submit started
  const startTime = Date.now();
  logger.info({
    event: 'SUBMIT_STARTED',
    scope: 'quiz',
    action_id: actionId,
    attempt_id: attemptId,
    question_id: questionId,
    client_ts: new Date().toISOString(),
    remaining_ms: 5000,
  });

  // After API call completes
  const durationMs = Date.now() - startTime;
  logger.info({
    event: 'SUBMIT_ACKED',
    scope: 'quiz',
    action_id: actionId,
    request_id: 'req-xyz',
    attempt_id: attemptId,
    question_id: questionId,
    status: 'accepted',
    duration_ms: durationMs,
    server_ts: new Date().toISOString(),
    client_ts: new Date().toISOString(),
    reason: 'valid_answer_within_time',
  });
}

// Example 2: Logging state transitions
export function exampleStateTransition() {
  logger.info({
    event: 'STATE_TRANSITION',
    scope: 'quiz',
    from: 'active',
    to: 'submitting',
    reason: 'user_click',
    attempt_id: 'attempt-123',
  });
}

// Example 3: Logging errors with context
export function exampleErrorLogging() {
  try {
    // Some operation
    throw new Error('Something went wrong');
  } catch (error: any) {
    logger.error({
      event: 'ERROR',
      scope: 'quiz',
      error_name: error.name,
      error_message: error.message,
      stack: error.stack, // Only in debug mode
      context: {
        quiz_id: 'quiz-456',
        question_id: 'question-789',
        action_id: 'action-abc',
        request_id: 'req-xyz',
        remaining_ms: 3000,
      },
      user_outcome: 'showed_retry_toast',
    });
  }
}

// Example 4: Logging with user ID (hashed for privacy)
export function exampleUserLogging(userId: string) {
  const userIdHash = hashUserId(userId);
  
  logger.info({
    event: 'USER_ACTION',
    scope: 'auth',
    user_id_hash: userIdHash,
    action: 'profile_viewed',
  });
}

// Example 5: Getting diagnostic bundle
export async function exampleDiagnosticBundle() {
  const bundle = logger.getDiagnosticBundle();
  console.log('Bundle ID:', bundle.bundleId);
  console.log('Log count:', bundle.logs.length);
  
  // Copy to clipboard (for user to paste to AI)
  await logger.copyDiagnosticBundleToClipboard();
  console.log('Bundle copied to clipboard!');
}

// Example 6: Using in React components with hooks
export function exampleReactComponent() {
  // In your component:
  // import { useRouteLogging, useViewLoadLogging } from '@/lib/logger-hooks';
  // 
  // useRouteLogging(); // Automatically logs route changes
  // useViewLoadLogging('QuizPage'); // Logs view load timing
}
