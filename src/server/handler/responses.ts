import type { UploadErrorContext } from './options';

export class UploadValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
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

export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function handleUnexpectedError(
  error: unknown,
  ctx: UploadErrorContext,
  onError?: (error: unknown, ctx: UploadErrorContext) => void,
): Response {
  if (isClientValidationError(error)) {
    const message =
      error instanceof Error ? error.message : 'Invalid upload request';
    return jsonResponse({ error: message }, 400);
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
