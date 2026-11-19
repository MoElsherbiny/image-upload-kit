import { DEFAULT_ALLOWED_FORMATS } from '../../types';
import { isRetryableUploadError } from '../../types/errors';
import { validateImageFileStrict } from '../../utils/validators';
import {
  checkAllowedOrigin,
  generateId,
  guardRouteAccess,
  kitErrorResponse,
  normalizeOverrides,
  resolveClientFolder,
  sanitizeFolderSegment,
} from './guards';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import { enforceQuota, recordQuotaUsage } from './rateLimitGuard';
import { handleUnexpectedError, jsonResponse } from './responses';
import {
  createMemoryResumableSessionStore,
  DEFAULT_RESUMABLE_SESSION_TTL_MS,
  type MemoryResumableSessionStoreOptions,
  type ResumableSessionRecord,
  type ResumableSessionStore,
} from './resumableStore';
import { readBoundedJsonBody, readBoundedStreamBytes, sha256Hex } from './streamBody';

export {
  createMemoryResumableSessionStore,
  type MemoryResumableSessionStoreOptions,
  type ResumableSessionRecord,
  type ResumableSessionStore,
};

export interface ResumableUploadHandlerOptions<TPreset extends string = string>
  extends Pick<
    UploadHttpHandlerOptions<TPreset>,
    | 'uploader'
    | 'authorize'
    | 'getSubject'
    | 'allowedOrigins'
    | 'allowedPresets'
    | 'allowedBuckets'
    | 'allowClientBucketOverride'
    | 'allowClientOverrides'
    | 'rateLimiter'
    | 'quotaProvider'
    | 'rateLimitKey'
    | 'trustProxy'
    | 'onError'
  > {
  store?: ResumableSessionStore;
  defaultChunkSize?: number;
  maxChunkSize?: number;
  sessionTtlMs?: number;
  now?: () => number;
}

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_MAX_CHUNK_SIZE = 10 * 1024 * 1024;

/** Creates Web Fetch handlers (`POST`, `PATCH`, `DELETE`) for resumable chunked uploads. */
export function createResumableUploadHandler<TPreset extends string = string>(
  options: ResumableUploadHandlerOptions<TPreset>,
) {
  const { uploader, allowedOrigins, onError } = options;
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? createMemoryResumableSessionStore({ now });
  const defaultChunkSize = options.defaultChunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxChunkSize = options.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_RESUMABLE_SESSION_TTL_MS;
  const completing = new Set<string>();

  async function guardSession(request: Request, sessionId: string, action: 'upload' | 'delete') {
    const access = await guardRouteAccess(options, { action, request }, action);
    if (access.errorResponse) return { errorResponse: access.errorResponse };
    const session = await store.get(sessionId);
    if (!session) return { errorResponse: kitErrorResponse('Resumable upload session not found', 'INVALID_UPLOAD_TOKEN', 404, false) };
    if (session.subject !== undefined && session.subject !== access.subject) {
      return { errorResponse: kitErrorResponse('Session subject mismatch', 'FORBIDDEN', 403, false) };
    }
    if (action === 'upload' && now() > session.expiresAt) {
      await store.delete(session.id);
      return { errorResponse: kitErrorResponse('Resumable upload session expired', 'UPLOAD_EXPIRED', 410, false) };
    }
    return { session, subject: access.subject };
  }

  async function handleInit(request: Request): Promise<Response> {
    const originErr = checkAllowedOrigin(request, allowedOrigins);
    if (originErr) return originErr;
    const { body, errorResponse } = await readBoundedJsonBody(request, 16_384);
    if (errorResponse || !body) return errorResponse!;

    const overrides = normalizeOverrides(options.allowClientOverrides);
    const preset = typeof body.preset === 'string' && body.preset ? (body.preset as TPreset) : undefined;
    const rawBucket = typeof body.bucket === 'string' && body.bucket ? body.bucket : undefined;
    const rawFolder = typeof body.folder === 'string' ? body.folder : undefined;
    const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'upload.bin';
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
    const totalSize = Number(body.totalSize);
    const reqChunk = body.chunkSize !== undefined ? Number(body.chunkSize) : defaultChunkSize;

    const presetConfig = preset && typeof uploader.resolvePreset === 'function' ? uploader.resolvePreset(preset) : undefined;
    const authBucket = (options.allowClientBucketOverride ? rawBucket : undefined) || presetConfig?.bucket || uploader.defaultBucket;
    const authFolder = overrides?.folder ? (rawFolder ? sanitizeFolderSegment(rawFolder) : undefined) || presetConfig?.folder : presetConfig?.folder;
    const authCtx: AuthorizeContext = { action: 'upload', request, ...(authBucket ? { bucket: authBucket } : {}), ...(preset ? { preset } : {}), ...(authFolder ? { path: authFolder } : {}) };
    const access = await guardRouteAccess(options, authCtx, 'upload', Number.isFinite(totalSize) ? totalSize : undefined);
    if (access.errorResponse) return access.errorResponse;
    const quotaErr = await enforceQuota(options, { action: 'upload', request, subject: access.subject, bytes: Number.isFinite(totalSize) && totalSize > 0 ? totalSize : 0, bucket: authBucket, preset });
    if (quotaErr) return quotaErr;

    if (preset && options.allowedPresets && !options.allowedPresets.includes(preset)) return kitErrorResponse(`Invalid preset "${preset}"`, 'INVALID_IMAGE', 400, false);
    if (preset && typeof uploader.resolvePreset === 'function' && !presetConfig) return kitErrorResponse(`Invalid preset "${preset}"`, 'INVALID_IMAGE', 400, false);
    if (rawBucket && options.allowedBuckets && !options.allowedBuckets.includes(rawBucket)) return kitErrorResponse(`Bucket "${rawBucket}" is not allowed`, 'FORBIDDEN', 403, false);
    const resolvedFolder = resolveClientFolder(rawFolder, overrides, authCtx);
    if (resolvedFolder.errorResponse) return resolvedFolder.errorResponse;
    if (!contentType || !Number.isFinite(totalSize) || totalSize <= 0) return kitErrorResponse('Invalid contentType or totalSize', 'INVALID_IMAGE', 400, false);

    const limits = uploader.resolveUploadLimits?.(preset) ?? {
      maxSizeMB: uploader.getMaxSizeMB?.(preset ? [preset] : options.allowedPresets) ?? 10,
      allowedFormats: DEFAULT_ALLOWED_FORMATS, allowSvg: false, defaultFolder: '',
    };
    const maxBytes = Math.floor(limits.maxSizeMB * 1024 * 1024);
    if (totalSize > maxBytes) return kitErrorResponse(`File exceeds max size of ${maxBytes} bytes`, 'FILE_TOO_LARGE', 413, false);
    const check = validateImageFileStrict({ size: totalSize, type: contentType }, limits.maxSizeMB, limits.allowedFormats);
    if (!check.valid) return kitErrorResponse(check.error || 'Unsupported format', 'UNSUPPORTED_FORMAT', 400, false);

    const chunkSize = Math.max(1, Math.min(maxChunkSize, Math.floor(Number.isFinite(reqChunk) && reqChunk > 0 ? reqChunk : defaultChunkSize)));
    const createdAt = now();
    const expiresAt = createdAt + sessionTtlMs;
    const record: ResumableSessionRecord = {
      id: generateId(), filename, contentType, totalSize: Math.floor(totalSize), chunkSize, receivedBytes: 0, createdAt, expiresAt,
      ...(access.subject ? { subject: access.subject } : {}),
      ...(authBucket ? { bucket: authBucket } : {}),
      ...(resolvedFolder.folder ? { folder: resolvedFolder.folder } : {}),
      ...(preset ? { preset } : {}),
    };
    await store.create(record);
    return jsonResponse({ sessionId: record.id, chunkSize, totalSize: record.totalSize, offset: 0, expiresAt: new Date(expiresAt).toISOString() }, 201);
  }

  async function handleComplete(request: Request, sessionId: string): Promise<Response> {
    const { session, subject, errorResponse } = await guardSession(request, sessionId, 'upload');
    if (errorResponse || !session) return errorResponse!;
    if (session.receivedBytes !== session.totalSize) return kitErrorResponse('Resumable upload is incomplete', 'INVALID_IMAGE', 400, false);
    const quotaErr = await enforceQuota(options, { action: 'finalize', request, subject, bytes: session.totalSize, bucket: session.bucket, preset: session.preset });
    if (quotaErr) return quotaErr;
    if (completing.has(session.id)) return kitErrorResponse('Resumable upload is already being completed', 'INVALID_UPLOAD_TOKEN', 409, false);
    completing.add(session.id);
    if (typeof store.claimForCompletion === 'function' && !(await store.claimForCompletion(session.id))) {
      completing.delete(session.id);
      return kitErrorResponse('Resumable upload is already being completed', 'INVALID_UPLOAD_TOKEN', 409, false);
    }

    let keepSessionForRetry = false;
    try {
      const assembled = await store.assemble(session.id);
      const presetBucket =
        (session.preset && typeof uploader.resolvePreset === 'function'
          ? uploader.resolvePreset(session.preset)?.bucket
          : undefined) || uploader.defaultBucket;
      const bucketOverride = session.bucket && session.bucket !== presetBucket ? session.bucket : undefined;
      const result = await uploader.uploadImage(
        { buffer: Buffer.from(assembled.buffer, assembled.byteOffset, assembled.byteLength), name: session.filename, type: session.contentType, size: assembled.byteLength },
        { preset: session.preset as TPreset | undefined, ...(bucketOverride ? { bucket: bucketOverride } : {}), folder: session.folder, signal: request.signal },
      );
      await recordQuotaUsage(options, { action: 'finalize', request, subject, bytes: result.size ?? assembled.byteLength, bucket: result.bucket, preset: result.preset });
      return jsonResponse(result, 200);
    } catch (err) {
      if (isRetryableUploadError(err)) keepSessionForRetry = true;
      throw err;
    } finally {
      completing.delete(session.id);
      if (keepSessionForRetry) {
        await store.releaseCompletion?.(session.id);
      } else {
        await store.delete(session.id);
      }
    }
  }

  async function POST(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      const action = searchParams.get('action');
      if (action === 'init') return await handleInit(request);
      if (action === 'complete') return await handleComplete(request, searchParams.get('sessionId') || '');
      return kitErrorResponse('Unsupported resumable action', 'INVALID_IMAGE', 400, false);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'upload', request }, onError);
    }
  }

  async function PATCH(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      if (searchParams.get('action') !== 'chunk') return kitErrorResponse('Unsupported resumable action', 'INVALID_IMAGE', 400, false);
      const offset = Number(searchParams.get('offset'));
      const { session, errorResponse } = await guardSession(request, searchParams.get('sessionId') || '', 'upload');
      if (errorResponse || !session) return errorResponse!;
      if (!Number.isInteger(offset) || offset < 0 || offset > session.receivedBytes) return kitErrorResponse('Invalid chunk offset', 'INVALID_IMAGE', 400, false);
      const { bytes, errorResponse: readErr } = await readBoundedStreamBytes(request, Math.min(maxChunkSize, session.totalSize - offset), 'Chunk size exceeds allowed limit');
      if (readErr || !bytes) return readErr!;
      const expectedSha = request.headers.get('x-chunk-sha256')?.trim().toLowerCase();
      if (expectedSha && (await sha256Hex(bytes)) !== expectedSha) return kitErrorResponse('Chunk SHA-256 checksum mismatch', 'INVALID_IMAGE', 400, false);
      const updated = await store.appendChunk(session.id, offset, bytes);
      return jsonResponse({ sessionId: updated.id, offset: updated.receivedBytes, receivedBytes: updated.receivedBytes, totalSize: updated.totalSize }, 200);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'upload', request }, onError);
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      if (searchParams.get('action') !== 'abort') return kitErrorResponse('Unsupported resumable action', 'INVALID_IMAGE', 400, false);
      const { session, errorResponse } = await guardSession(request, searchParams.get('sessionId') || '', 'delete');
      if (errorResponse || !session) return errorResponse!;
      await store.delete(session.id);
      return jsonResponse({ aborted: true, sessionId: session.id }, 200);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'delete', request }, onError);
    }
  }

  return { POST, PATCH, DELETE };
}
