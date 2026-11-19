export type UploadErrorCode =
  | 'FILE_TOO_LARGE'
  | 'INVALID_IMAGE'
  | 'UNSUPPORTED_FORMAT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'UPLOAD_EXPIRED'
  | 'INVALID_UPLOAD_TOKEN'
  | 'RATE_LIMITED'
  | 'STORAGE_ERROR'
  | 'PROCESSING_FAILED'
  | 'UPLOAD_CANCELLED'
  | 'RESOURCE_LIMIT_EXCEEDED';

export interface UploadKitErrorOptions {
  code: UploadErrorCode;
  status?: number;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
  cause?: unknown;
}

const DEFAULT_STATUS_BY_CODE: Record<UploadErrorCode, number> = {
  FILE_TOO_LARGE: 413,
  INVALID_IMAGE: 400,
  UNSUPPORTED_FORMAT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  UPLOAD_EXPIRED: 400,
  INVALID_UPLOAD_TOKEN: 400,
  RATE_LIMITED: 429,
  STORAGE_ERROR: 502,
  PROCESSING_FAILED: 500,
  UPLOAD_CANCELLED: 499,
  RESOURCE_LIMIT_EXCEEDED: 503,
};

const DEFAULT_RETRYABLE_BY_CODE: Record<UploadErrorCode, boolean> = {
  FILE_TOO_LARGE: false,
  INVALID_IMAGE: false,
  UNSUPPORTED_FORMAT: false,
  UNAUTHORIZED: false,
  FORBIDDEN: false,
  UPLOAD_EXPIRED: false,
  INVALID_UPLOAD_TOKEN: false,
  RATE_LIMITED: true,
  STORAGE_ERROR: true,
  PROCESSING_FAILED: false,
  UPLOAD_CANCELLED: false,
  RESOURCE_LIMIT_EXCEEDED: true,
};

export interface SerializedUploadError {
  error: string;
  code: UploadErrorCode;
  retryable: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Structured error shared across server handlers, storage adapters, and client uploaders.
 * Internal `cause` is preserved for server-side logging and never serialized to clients.
 */
export class UploadKitError extends Error {
  readonly code: UploadErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly metadata?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(message: string, options: UploadKitErrorOptions) {
    super(message);
    this.name = 'UploadKitError';
    this.code = options.code;
    this.status = options.status ?? DEFAULT_STATUS_BY_CODE[options.code];
    this.retryable =
      options.retryable ?? DEFAULT_RETRYABLE_BY_CODE[options.code];
    this.metadata = options.metadata;
    this.cause = options.cause;
  }

  toPublicJSON(): SerializedUploadError {
    return {
      error: this.message,
      code: this.code,
      retryable: this.retryable,
      ...(this.metadata ? { metadata: this.metadata } : {}),
    };
  }
}

export function isUploadKitError(err: unknown): err is UploadKitError {
  return (
    err instanceof UploadKitError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { name?: unknown }).name === 'UploadKitError' &&
      typeof (err as { code?: unknown }).code === 'string')
  );
}

export function isRetryableUploadError(err: unknown): boolean {
  if (isUploadKitError(err)) return err.retryable;
  if (
    typeof err === 'object' &&
    err !== null &&
    'retryable' in err &&
    typeof (err as { retryable?: unknown }).retryable === 'boolean'
  ) {
    return (err as { retryable: boolean }).retryable;
  }
  return false;
}
