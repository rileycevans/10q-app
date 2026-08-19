/**
 * Standardized response format for all Edge Functions
 */

import { corsHeaders, corsHeadersFor } from "./cors.ts";

/**
 * Resolve CORS headers for a response.
 *
 * Pass the Request wherever possible: a static Access-Control-Allow-Origin
 * cannot serve the web app and both Capacitor shells at once (precondition
 * 0D). The static fallback exists so call sites can migrate incrementally
 * rather than in one 25-function sweep.
 */
function resolveCors(req?: Request): Record<string, string> {
  return req ? corsHeadersFor(req) : corsHeaders;
}

// Error codes (mirrored from contracts package for Deno compatibility)
export const ErrorCodes = {
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

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  request_id: string;
}

export function successResponse<T>(
  data: T,
  requestId: string,
  req?: Request,
): Response {
  const response: ApiResponse<T> = {
    ok: true,
    data,
    request_id: requestId,
  };

  return new Response(JSON.stringify(response), {
    headers: { 
      "Content-Type": "application/json",
      ...resolveCors(req),
    },
    status: 200,
  });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  status: number = 400,
  details?: unknown,
  req?: Request,
): Response {
  const response: ApiResponse<never> = {
    ok: false,
    error: {
      code,
      message,
      details,
    },
    request_id: requestId,
  };

  return new Response(JSON.stringify(response), {
    headers: { 
      "Content-Type": "application/json",
      ...resolveCors(req),
    },
    status,
  });
}

