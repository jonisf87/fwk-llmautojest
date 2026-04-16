/**
 * Shared test helpers — retry logic and general utilities.
 */

// ============================================================================
// Retry Constants
// ============================================================================

export const RETRY_CONSTANTS = {
  MAX_ATTEMPTS: 3,
  INITIAL_BACKOFF_MS: 1000,
  BACKOFF_MULTIPLIER: 2,
  MAX_BACKOFF_MS: 16000,
  JITTER_FACTOR: 0.1,
  RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504]
}

// ============================================================================
// Retry Helpers
// ============================================================================

/**
 * Calculate exponential backoff with jitter for a given attempt number (1-indexed).
 */
export function calculateRetryDelay(attempt: number): number {
  const base = RETRY_CONSTANTS.INITIAL_BACKOFF_MS * Math.pow(RETRY_CONSTANTS.BACKOFF_MULTIPLIER, attempt - 1)
  const capped = Math.min(base, RETRY_CONSTANTS.MAX_BACKOFF_MS)
  const jitter = capped * RETRY_CONSTANTS.JITTER_FACTOR * (Math.random() * 2 - 1)
  return Math.floor(capped + jitter)
}

/**
 * Retry an async operation with exponential backoff.
 *
 * @param fn - Operation to retry
 * @param isRetryable - Returns true if the error should trigger a retry
 * @param wrapFinalError - Wraps the final error after all attempts are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  wrapFinalError: (error: Error) => Error
): Promise<T> {
  let lastError: Error = new Error('Unknown error')

  for (let attempt = 1; attempt <= RETRY_CONSTANTS.MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === RETRY_CONSTANTS.MAX_ATTEMPTS || !isRetryable(error)) {
        throw wrapFinalError(lastError)
      }

      const delay = calculateRetryDelay(attempt)
      console.warn(`[retry] Attempt ${attempt}/${RETRY_CONSTANTS.MAX_ATTEMPTS} failed: ${lastError.message}. Retrying in ${delay}ms…`)
      await sleep(delay)
    }
  }

  throw wrapFinalError(lastError)
}

/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sample standard deviation (N-1 denominator).
 */
export function sampleStddev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1)
  return Math.sqrt(variance)
}
