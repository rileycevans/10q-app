/**
 * Stable error codes for 10Q API.
 * All Edge Functions must use these codes only.
 * Never invent ad-hoc error strings.
 */

export const ErrorCodes = {
  // Attempt errors
  ATTEMPT_ALREADY_COMPLETED: "ATTEMPT_ALREADY_COMPLETED",
  ATTEMPT_NOT_FOUND: "ATTEMPT_NOT_FOUND",
  ATTEMPT_ALREADY_EXISTS: "ATTEMPT_ALREADY_EXISTS",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  
  // Question errors
  QUESTION_ALREADY_ANSWERED: "QUESTION_ALREADY_ANSWERED",
  QUESTION_EXPIRED: "QUESTION_EXPIRED",
  QUESTION_NOT_FOUND: "QUESTION_NOT_FOUND",
  
  // Quiz errors
  QUIZ_NOT_AVAILABLE: "QUIZ_NOT_AVAILABLE",
  QUIZ_NOT_FOUND: "QUIZ_NOT_FOUND",
  
  // Authorization errors
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  NOT_A_MEMBER: "NOT_A_MEMBER",
  
  // League errors
  LEAGUE_NOT_FOUND: "LEAGUE_NOT_FOUND",
  
  // Validation errors
  VALIDATION_ERROR: "VALIDATION_ERROR",
  
  // Leaderboard errors
  NO_VIEWER_SCORE: "NO_VIEWER_SCORE",
  
  // Service errors
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: ApiError;
  request_id: string;
}

