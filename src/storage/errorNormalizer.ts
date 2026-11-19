import { isUploadKitError, type UploadErrorCode, UploadKitError } from '../types/errors';

export interface StorageErrorContext {
  provider?: string;
  operation?: string;
  bucket?: string;
  path?: string;
}

interface RawStorageErrorShape {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: unknown };
}

function readHttpStatus(err: RawStorageErrorShape): number | undefined {
  const raw = err.$metadata?.httpStatusCode ?? err.statusCode ?? err.status;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function buildSafeMessage(
  summary: string,
  context?: StorageErrorContext,
): string {
  const op = context?.operation ? ` ${context.operation}` : '';
  const provider = context?.provider ? ` (${context.provider})` : '';
  return `Storage${op} failed${provider}: ${summary}`;
}

/**
 * Validates and normalizes a storage object key or relative path, rejecting
 * null bytes (`\0`) and path traversal segments (`.` and `..`).
 */
export function sanitizeStorageKey(
  rawPath: string,
  label = 'storage',
): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new UploadKitError(`Invalid ${label} path`, {
      code: 'STORAGE_ERROR',
      status: 400,
      retryable: false,
    });
  }
  if (rawPath.includes('\0')) {
    throw new UploadKitError(
      `Invalid ${label} path: null byte blocked`,
      { code: 'FORBIDDEN', status: 400, retryable: false },
    );
  }
  const segments = rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length === 0) {
    throw new UploadKitError(`Invalid ${label} path`, {
      code: 'STORAGE_ERROR',
      status: 400,
      retryable: false,
    });
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new UploadKitError(
        `Invalid ${label} path: path traversal blocked`,
        { code: 'FORBIDDEN', status: 400, retryable: false },
      );
    }
  }
  return segments.join('/');
}

/**
 * Normalizes provider-specific storage errors (S3, Supabase, LocalFS, network)
 * into a structured `UploadKitError` with safe client-facing messages and
 * `retryable` classification.
 */
export function normalizeStorageError(
  err: unknown,
  context?: StorageErrorContext,
): UploadKitError {
  if (isUploadKitError(err)) return err;

  const shape: RawStorageErrorShape =
    err && typeof err === 'object' ? (err as RawStorageErrorShape) : {};
  const status = readHttpStatus(shape);
  const codeStr = String(shape.code ?? shape.name ?? '').toLowerCase();
  const msgStr =
    typeof shape.message === 'string' ? shape.message.toLowerCase() : '';

  const metadata = context
    ? {
        ...(context.provider ? { provider: context.provider } : {}),
        ...(context.operation ? { operation: context.operation } : {}),
      }
    : undefined;

  const make = (
    code: UploadErrorCode,
    httpStatus: number,
    retryable: boolean,
    summary: string,
  ) =>
    new UploadKitError(buildSafeMessage(summary, context), {
      code,
      status: httpStatus,
      retryable,
      metadata,
      cause: err,
    });

  if (
    status === 401 ||
    codeStr === 'unauthorized' ||
    codeStr === 'invalidaccesskeyid' ||
    codeStr === 'signaturedoesnotmatch' ||
    codeStr === 'expiredtoken' ||
    msgStr.includes('unauthorized')
  ) {
    return make('UNAUTHORIZED', 401, false, 'Authentication failed');
  }

  if (
    status === 403 ||
    codeStr === 'forbidden' ||
    codeStr === 'accessdenied' ||
    codeStr === 'eacces' ||
    codeStr === 'eperm' ||
    msgStr.includes('access denied') ||
    msgStr.includes('forbidden')
  ) {
    return make('FORBIDDEN', 403, false, 'Access denied');
  }

  if (
    status === 413 ||
    codeStr === 'entitytoolarge' ||
    codeStr === 'payloadtoolarge'
  ) {
    return make('FILE_TOO_LARGE', 413, false, 'Object exceeds storage size limit');
  }

  if (
    status === 429 ||
    codeStr === 'slowdown' ||
    codeStr === 'throttling' ||
    codeStr === 'toomanyrequests' ||
    msgStr.includes('rate limit')
  ) {
    return make('RATE_LIMITED', 429, true, 'Storage provider rate limit exceeded');
  }

  if (
    status === 503 ||
    codeStr === 'serviceunavailable' ||
    codeStr === 'enospc' ||
    codeStr === 'quotaexceeded' ||
    msgStr.includes('quota') ||
    msgStr.includes('no space left')
  ) {
    return make('RESOURCE_LIMIT_EXCEEDED', 503, true, 'Storage capacity or quota exceeded');
  }

  if (
    status === 404 ||
    codeStr === 'notfound' ||
    codeStr === 'nosuchkey' ||
    codeStr === 'nosuchbucket' ||
    codeStr === 'enoent'
  ) {
    return make('STORAGE_ERROR', 404, false, 'Object or bucket not found');
  }

  if (
    status === 409 ||
    status === 412 ||
    codeStr === 'eexist' ||
    codeStr === 'preconditionfailed'
  ) {
    return make('STORAGE_ERROR', status ?? 409, false, 'Object conflict or precondition failed');
  }

  if (status === 400 || codeStr === 'invalidargument' || codeStr === 'invalidkey') {
    return make('STORAGE_ERROR', 400, false, 'Invalid storage request');
  }

  if (
    codeStr === 'etimedout' ||
    codeStr === 'econnreset' ||
    codeStr === 'econnrefused' ||
    codeStr === 'epipe' ||
    codeStr === 'networkingerror' ||
    msgStr.includes('timeout') ||
    msgStr.includes('network')
  ) {
    return make('STORAGE_ERROR', 504, true, 'Storage network request timed out');
  }

  const isServerErr = status !== undefined && status >= 500;
  return make(
    'STORAGE_ERROR',
    isServerErr ? status : 502,
    true,
    'Storage backend error',
  );
}
