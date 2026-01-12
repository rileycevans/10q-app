/**
 * Error handling utilities with retry logic
 * Implements exponential backoff for network failures
 */

import type { ErrorCode } from '@10q/contracts';

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableStatusCodes?: number[];
  retryableErrorCodes?: ErrorCode[];
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504], // Timeout, rate limit, server errors
  retryableErrorCodes: ['SERVICE_UNAVAILABLE'],
};

/**
 * Check if an error is retryable
 */
function isRetryableError(
  error: { code?: ErrorCode; message?: string },
  statusCode?: number,
  retryableStatusCodes: number[],
  retryableErrorCodes: ErrorCode[]
): boolean {
  // Check status code
  if (statusCode && retryableStatusCodes.includes(statusCode)) {
    return true;
  }

  // Check error code
  if (error.code && retryableErrorCodes.includes(error.code)) {
    return true;
  }

  // Check for network errors (no status code usually means network failure)
  if (!statusCode && error.message) {
    const networkErrorPatterns = [
      /network/i,
      /fetch/i,
      /connection/i,
      /timeout/i,
      /failed to fetch/i,
    ];
    return networkErrorPatterns.some((pattern) => pattern.test(error.message!));
  }

  return false;
}

/**
 * Calculate delay for exponential backoff
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number
): number {
  const delay = initialDelay * Math.pow(backoffMultiplier, attempt);
  return Math.min(delay, maxDelay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt >= opts.maxRetries) {
        break;
      }

      // Check if error is retryable
      const statusCode = error.status || error.statusCode;
      const errorObj = error.error || error;
      
      if (!isRetryableError(errorObj, statusCode, opts.retryableStatusCodes, opts.retryableErrorCodes)) {
        // Not retryable, throw immediately
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateDelay(
        attempt,
        opts.initialDelay,
        opts.maxDelay,
        opts.backoffMultiplier
      );

      console.warn(
        `Retry attempt ${attempt + 1}/${opts.maxRetries} after ${delay}ms`,
        error
      );

      await sleep(delay);
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyErrorMessage(
  error: { code?: ErrorCode; message?: string },
  statusCode?: number
): string {
  // Handle specific error codes
  if (error.code) {
    switch (error.code) {
      case 'NOT_AUTHORIZED':
        return 'Please sign in to continue.';
      case 'QUIZ_NOT_AVAILABLE':
        return 'No quiz available right now. Check back at 11:30 UTC!';
      case 'ATTEMPT_NOT_FOUND':
        return 'Attempt not found. Please start a new quiz.';
      case 'ATTEMPT_ALREADY_COMPLETED':
        return 'This quiz has already been completed.';
      case 'QUESTION_EXPIRED':
        return 'Time ran out for this question.';
      case 'VALIDATION_ERROR':
        return error.message || 'Invalid input. Please check your data.';
      case 'SERVICE_UNAVAILABLE':
        return 'Service temporarily unavailable. Please try again in a moment.';
      default:
        return error.message || 'An error occurred. Please try again.';
    }
  }

  // Handle HTTP status codes
  if (statusCode) {
    switch (statusCode) {
      case 401:
        return 'Please sign in to continue.';
      case 403:
        return 'You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 408:
        return 'Request timed out. Please try again.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
      case 502:
      case 503:
      case 504:
        return 'Server error. Please try again in a moment.';
      default:
        return error.message || `Error: ${statusCode}`;
    }
  }

  // Generic error
  return error.message || 'An unexpected error occurred. Please try again.';
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: any): boolean {
  if (!error) return false;
  
  // Check for fetch network errors
  if (error.message) {
    const networkPatterns = [
      /failed to fetch/i,
      /network error/i,
      /network request failed/i,
      /fetch failed/i,
      /connection/i,
    ];
    return networkPatterns.some((pattern) => pattern.test(error.message));
  }

  // Check for no response (usually network error)
  if (!error.status && !error.statusCode && !error.code) {
    return true;
  }

  return false;
}

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: any): boolean {
  if (!error) return false;
  
  const errorObj = error.error || error;
  
  if (errorObj.code === 'NOT_AUTHORIZED') {
    return true;
  }

  const statusCode = error.status || error.statusCode;
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  if (errorObj.message) {
    const authPatterns = [
      /authentication/i,
      /authorization/i,
      /sign in/i,
      /sign-in/i,
      /unauthorized/i,
      /forbidden/i,
    ];
    return authPatterns.some((pattern) => pattern.test(errorObj.message));
  }

  return false;
}

