import {
  isUploadKitError,
  UploadKitError,
  type UploadKitErrorOptions,
} from '../../types/errors';
import type { UploadErrorContext } from './options';

export class UploadValidationError extends UploadKitError {
  constructor(
    message: string,
    options?: Partial<UploadKitErrorOptions>,
  ) {
    super(message, {
      code: options?.code ?? 'INVALID_IMAGE',
      status: options?.status ?? 400,
      retryable: options?.retryable ?? false,
      metadata: options?.metadata,
      cause: options?.cause,
    });
    this.name = 'UploadValidationError';
  }
}

export function isClientValidationError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof UploadValidationError) return true;
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 400
  ) {
    return true;
  }
  if (
    error instanceof Error &&
    (error.name === 'UploadValidationError' || error.name === 'ValidationError')
  ) {
    return true;
  }
  return false;
}

export function jsonResponse(
  body: unknown,
  status: number = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

/**
 * Serializes an `UploadKitError` to a safe client HTTP response using `toPublicJSON()`.
 * Never leaks `cause` or stack traces. Automatically attaches `Retry-After` when present.
 */
export function errorResponseFromKitError(
  error: UploadKitError,
  extraHeaders?: Record<string, string>,
): Response {
  const headers: Record<string, string> = { ...extraHeaders };
  const retryAfter = error.metadata?.retryAfterSeconds;
  if (
    !headers['Retry-After'] &&
    typeof retryAfter === 'number' &&
    Number.isFinite(retryAfter) &&
    retryAfter > 0
  ) {
    headers['Retry-After'] = String(Math.ceil(retryAfter));
  }
  return jsonResponse(error.toPublicJSON(), error.status, headers);
}

export function handleUnexpectedError(
  error: unknown,
  ctx: UploadErrorContext,
  onError?: (error: unknown, ctx: UploadErrorContext) => void,
): Response {
  if (isUploadKitError(error)) {
    if (error.status >= 500) {
      try {
        onError?.(error, ctx);
      } catch {
        // Ignore secondary logger failures
      }
    }
    return errorResponseFromKitError(error);
  }

  if (isClientValidationError(error)) {
    const message =
      error instanceof Error ? error.message : 'Invalid upload request';
    return jsonResponse(
      { error: message, code: 'INVALID_IMAGE', retryable: false },
      400,
    );
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status;
    if (status >= 400 && status < 500) {
      const message =
        error instanceof Error ? error.message : 'Request rejected';
      return jsonResponse({ error: message }, status);
    }
    if (status === 503) {
      return jsonResponse(
        { error: 'Server busy, please try again later' },
        503,
      );
    }
  }

  try {
    onError?.(error, ctx);
  } catch {
    // Ignore secondary logger failures
  }

  return jsonResponse({ error: 'Internal server error' }, 500);
}
