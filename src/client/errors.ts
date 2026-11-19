import {
  isUploadKitError,
  type UploadErrorCode,
  UploadKitError,
} from '../types/errors';

const VALID_ERROR_CODES: ReadonlySet<UploadErrorCode> = new Set<UploadErrorCode>([
  'FILE_TOO_LARGE',
  'INVALID_IMAGE',
  'UNSUPPORTED_FORMAT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'UPLOAD_EXPIRED',
  'INVALID_UPLOAD_TOKEN',
  'RATE_LIMITED',
  'STORAGE_ERROR',
  'PROCESSING_FAILED',
  'UPLOAD_CANCELLED',
  'RESOURCE_LIMIT_EXCEEDED',
]);

function isUploadErrorCode(value: unknown): value is UploadErrorCode {
  return (
    typeof value === 'string' &&
    VALID_ERROR_CODES.has(value as UploadErrorCode)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapStatusToDefaults(status: number): {
  code: UploadErrorCode;
  retryable: boolean;
} {
  if (status === 401) return { code: 'UNAUTHORIZED', retryable: false };
  if (status === 403) return { code: 'FORBIDDEN', retryable: false };
  if (status === 413) return { code: 'FILE_TOO_LARGE', retryable: false };
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true };
  if (status === 503) {
    return { code: 'RESOURCE_LIMIT_EXCEEDED', retryable: true };
  }
  if (status >= 500 && status <= 599) {
    return { code: 'STORAGE_ERROR', retryable: true };
  }
  if (status >= 400 && status <= 499) {
    return { code: 'INVALID_IMAGE', retryable: false };
  }
  return { code: 'STORAGE_ERROR', retryable: true };
}

/**
 * Parses an HTTP error response body from an upload endpoint into a structured `UploadKitError`.
 * Preserves server-supplied `code`, `retryable`, and `metadata` when present; otherwise
 * maps the HTTP status code to a deterministic `UploadErrorCode` and retryability flag.
 */
export function parseClientUploadError(
  status: number,
  rawBody: string,
  fallbackMessage?: string,
): UploadKitError {
  let parsedMessage: string | undefined;
  let parsedCode: UploadErrorCode | undefined;
  let parsedRetryable: boolean | undefined;
  let parsedMetadata: Record<string, unknown> | undefined;

  if (typeof rawBody === 'string' && rawBody.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (isPlainRecord(parsed)) {
        if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
          parsedMessage = parsed.error.trim();
        } else if (
          typeof parsed.message === 'string' &&
          parsed.message.trim().length > 0
        ) {
          parsedMessage = parsed.message.trim();
        }
        if (isUploadErrorCode(parsed.code)) {
          parsedCode = parsed.code;
        }
        if (typeof parsed.retryable === 'boolean') {
          parsedRetryable = parsed.retryable;
        }
        if (isPlainRecord(parsed.metadata)) {
          parsedMetadata = parsed.metadata;
        }
      }
    } catch {
      // Non-JSON response body; fall back to status mapping
    }
  }

  const defaults = mapStatusToDefaults(status);
  const message =
    parsedMessage ||
    fallbackMessage ||
    `Upload failed with status ${status}`;

  if (parsedCode !== undefined) {
    return new UploadKitError(message, {
      code: parsedCode,
      status,
      ...(parsedRetryable !== undefined ? { retryable: parsedRetryable } : {}),
      ...(parsedMetadata ? { metadata: parsedMetadata } : {}),
    });
  }

  return new UploadKitError(message, {
    code: defaults.code,
    status,
    retryable: parsedRetryable ?? defaults.retryable,
    ...(parsedMetadata ? { metadata: parsedMetadata } : {}),
  });
}

/**
 * Creates a retryable `STORAGE_ERROR` representing a network or transport failure.
 */
export function createNetworkUploadError(
  message = 'Network error during upload',
  cause?: unknown,
): UploadKitError {
  return new UploadKitError(message, {
    code: 'STORAGE_ERROR',
    status: 0,
    retryable: true,
    cause,
  });
}

/**
 * Creates a non-retryable `UPLOAD_CANCELLED` error when an upload is aborted.
 */
export function createCancelledUploadError(
  message = 'Upload cancelled',
): UploadKitError {
  return new UploadKitError(message, {
    code: 'UPLOAD_CANCELLED',
    status: 499,
    retryable: false,
  });
}

/**
 * Returns `true` if `err` represents an explicit upload cancellation or `AbortError`.
 */
export function isAbortUploadError(err: unknown): boolean {
  if (isUploadKitError(err) && err.code === 'UPLOAD_CANCELLED') return true;
  if (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  ) {
    return true;
  }
  return false;
}
