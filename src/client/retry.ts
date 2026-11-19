import { isRetryableUploadError, isUploadKitError } from '../types/errors';
import { createCancelledUploadError, isAbortUploadError } from './errors';

export interface RetryOptions {
  /** Maximum total attempts including the initial call (default: `3`). */
  maxAttempts?: number;
  /** Base delay in milliseconds before the first retry (default: `250`). */
  baseDelayMs?: number;
  /** Upper bound for retry delay in milliseconds (default: `10000`). */
  maxDelayMs?: number;
  /** Apply randomized jitter to backoff delays to avoid thundering herds (default: `true`). */
  jitter?: boolean;
  /** Optional AbortSignal to cancel retries immediately during backoff waits. */
  signal?: AbortSignal;
  /** Custom predicate deciding whether a failed attempt should be retried. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional hook invoked right before sleeping for a retry attempt. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 401, 403, 413, 422]);

/**
 * Default retry predicate: never retries `400/401/403/413/422` or `AbortError`/`UPLOAD_CANCELLED`,
 * and otherwise delegates to `isRetryableUploadError(err)`.
 */
export function defaultShouldRetry(err: unknown): boolean {
  if (isAbortUploadError(err)) return false;

  if (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status?: unknown }).status === 'number' &&
    NON_RETRYABLE_HTTP_STATUSES.has((err as { status: number }).status)
  ) {
    return false;
  }

  return isRetryableUploadError(err);
}

/**
 * Computes exponential backoff delay (with optional equal jitter) for a 1-based failed attempt.
 */
export function computeRetryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean,
  err?: unknown,
): number {
  const safeBase = Math.max(0, baseDelayMs);
  const safeMax = Math.max(safeBase, maxDelayMs);

  let delay = Math.min(safeMax, safeBase * Math.pow(2, Math.max(0, attempt - 1)));

  if (isUploadKitError(err)) {
    const retryAfter = err.metadata?.retryAfterSeconds;
    if (
      typeof retryAfter === 'number' &&
      Number.isFinite(retryAfter) &&
      retryAfter > 0
    ) {
      delay = Math.min(safeMax, Math.max(delay, retryAfter * 1000));
    }
  }

  if (jitter && delay > 0) {
    delay = Math.round(delay * (0.5 + Math.random() * 0.5));
  }

  return Math.max(0, Math.min(safeMax, Math.round(delay)));
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createCancelledUploadError());
  }
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(createCancelledUploadError());
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs an async operation with exponential backoff + optional jitter retries.
 * Respects `AbortSignal` both before execution and during retry backoff sleeps.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const jitter = options.jitter ?? true;
  const signal = options.signal;
  const shouldRetry = options.shouldRetry ?? ((err) => defaultShouldRetry(err));

  if (signal?.aborted) {
    throw createCancelledUploadError();
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw createCancelledUploadError();
    }

    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (signal?.aborted || isAbortUploadError(err)) {
        throw isAbortUploadError(err) ? err : createCancelledUploadError();
      }

      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }

      const delayMs = computeRetryDelayMs(
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitter,
        err,
      );
      options.onRetry?.(err, attempt, delayMs);
      await sleepWithAbort(delayMs, signal);
    }
  }

  throw lastError;
}
