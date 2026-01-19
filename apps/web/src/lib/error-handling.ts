/**
 * Error Handling Utilities
 */

import type { ErrorCode } from '@10q/contracts';

interface ErrorInfo {
  code?: ErrorCode | string;
  message?: string;
}

// User-friendly error messages
const ERROR_MESSAGES: Record<string, string> = {
  AUTHENTICATION_REQUIRED: 'Please sign in to continue',
  NOT_AUTHORIZED: 'Please sign in to continue',
  QUIZ_NOT_FOUND: 'Quiz not found. Please try again.',
  ATTEMPT_NOT_FOUND: 'Quiz attempt not found.',
  ATTEMPT_ALREADY_COMPLETED: 'You have already completed this quiz.',
  QUESTION_NOT_FOUND: 'Question not found.',
  INVALID_STATE_TRANSITION: 'Invalid operation. Please refresh and try again.',
  INVALID_ANSWER: 'Invalid answer selection.',
  VALIDATION_ERROR: 'Invalid input. Please check your data.',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable. Please try again.',
  RATE_LIMITED: 'Too many requests. Please wait a moment.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
};

// Status code messages
const STATUS_MESSAGES: Record<number, string> = {
  401: 'Please sign in to continue.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested resource was not found.',
  429: 'Too many requests. Please wait a moment.',
  500: 'Server error. Please try again.',
  502: 'Service temporarily unavailable.',
  503: 'Service temporarily unavailable.',
  504: 'Request timed out. Please try again.',
};

export function getUserFriendlyErrorMessage(error?: ErrorInfo, status?: number): string {
  // First check error code
  if (error?.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  
  // Then check status code
  if (status && STATUS_MESSAGES[status]) {
    return STATUS_MESSAGES[status];
  }
  
  // Use error message if provided
  if (error?.message) {
    return error.message;
  }
  
  return 'An unexpected error occurred. Please try again.';
}

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  retryableStatusCodes?: number[];
  retryableErrorCodes?: string[];
}

/**
 * Retry wrapper for async functions with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    retryableStatusCodes = [408, 429, 500, 502, 503, 504],
    retryableErrorCodes = ['SERVICE_UNAVAILABLE', 'NETWORK_ERROR'],
  } = options;
  
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if we should retry
      const shouldRetry = attempt < maxRetries && (
        // Network error (no response)
        !error.status ||
        // Retryable status code
        retryableStatusCodes.includes(error.status) ||
        // Retryable error code
        (error.error?.code && retryableErrorCodes.includes(error.error.code))
      );
      
      if (!shouldRetry) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
      
      // Add jitter (±20%)
      const jitter = delay * 0.2 * (Math.random() - 0.5);
      
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }
  
  throw lastError;
}
