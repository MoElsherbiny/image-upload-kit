import type { StorageAdapter } from '../../storage/types';
import { DEFAULT_ALLOWED_FORMATS } from '../../types';
import { validateImageFileStrict } from '../../utils/validators';
import { assertMagicBytesAllowed } from '../security/sniffFormat';
import {
  checkAllowedOrigin,
  generateId,
  guardRouteAccess,
  kitErrorResponse,
  mimeToExtension,
  sanitizeFolderSegment,
  sanitizeMetadataRecord,
} from './guards';
import {
  bytesExcludingPart,
  createMemoryMultipartSessionStore,
  DEFAULT_MULTIPART_SESSION_TTL_MS,
  type MemoryMultipartSessionStoreOptions,
  type MultipartSessionRecord,
  type MultipartSessionStore,
  parsePartsList,
} from './multipartStore';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import { enforceQuota, recordQuotaUsage } from './rateLimitGuard';
import { handleUnexpectedError, jsonResponse } from './responses';
import { readBoundedJsonBody, readBoundedStreamBytes } from './streamBody';

export {
  createMemoryMultipartSessionStore,
  type MemoryMultipartSessionStoreOptions,
  type MultipartSessionRecord,
  type MultipartSessionStore,
};

export interface MultipartUploadHandlerOptions
  extends Pick<
    UploadHttpHandlerOptions,
    | 'authorize'
    | 'getSubject'
    | 'allowedOrigins'
    | 'allowedBuckets'
    | 'allowClientBucketOverride'
    | 'rateLimiter'
    | 'quotaProvider'
    | 'rateLimitKey'
    | 'trustProxy'
    | 'onError'
  > {
  storage: StorageAdapter;
  store?: MultipartSessionStore;
  defaultBucket?: string;
  maxPartBytes?: number;
  /** Maximum total bytes across all parts in a session. Defaults to 100 MB (`104_857_600`). */
  maxTotalBytes?: number;
  /** Allowed image MIME types. Defaults to `DEFAULT_ALLOWED_FORMATS` (no `application/octet-stream`). */
  allowedFormats?: string[];
  /** Allow clients to choose the target storage key via `body.path`. Defaults to `false`. */
  allowClientPathOverride?: boolean;
  /**
   * Download the assembled object after `completeMultipartUpload` and verify magic bytes with
   * `assertMagicBytesAllowed`, deleting invalid objects and returning 400 `INVALID_IMAGE`. Defaults to `true`.
   */
  validateOnComplete?: boolean;
  sessionTtlMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_PART_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MISSING_DOWNLOAD_MESSAGE =
  'Storage adapter does not support download() required for multipart content validation; implement storage.download or set validateOnComplete: false';

/** Creates Web Fetch handlers (`POST`, `PUT`, `DELETE`) for S3-compatible multipart uploads. */
export function createMultipartUploadHandler(options: MultipartUploadHandlerOptions) {
  const { storage, allowedOrigins, allowedBuckets, allowClientBucketOverride = false, onError } = options;
  const defaultBucket = options.defaultBucket ?? 'images';
  const maxPartBytes = options.maxPartBytes ?? DEFAULT_MAX_PART_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const allowedFormats = options.allowedFormats ?? DEFAULT_ALLOWED_FORMATS;
  const allowClientPathOverride = options.allowClientPathOverride ?? false;
  const validateOnComplete = options.validateOnComplete !== false;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_MULTIPART_SESSION_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? createMemoryMultipartSessionStore({ ttlMs: sessionTtlMs, now });

  const deleteRejectedObject = async (bucket: string, path: string, request: Request): Promise<void> => {
    await storage.delete(bucket, path).catch((cleanupErr) => {
      try {
        onError?.(cleanupErr, { action: 'upload', request });
      } catch {
        // Ignore secondary logger failures
      }
    });
  };

  async function guardSession(request: Request, uploadId: string, action: 'upload' | 'delete') {
    const access = await guardRouteAccess(options, { action, request }, action);
    if (access.errorResponse) return { errorResponse: access.errorResponse };
    const session = await store.get(uploadId);
    if (!session) return { errorResponse: kitErrorResponse('Multipart upload session not found', 'INVALID_UPLOAD_TOKEN', 404, false) };
    if (session.subject !== undefined && session.subject !== access.subject) {
      return { errorResponse: kitErrorResponse('Multipart upload subject mismatch', 'FORBIDDEN', 403, false) };
    }
    if (action === 'upload' && session.expiresAt <= now()) {
      await store.delete(session.uploadId);
      return { errorResponse: kitErrorResponse('Multipart upload session expired', 'UPLOAD_EXPIRED', 410, false) };
    }
    return { session, subject: access.subject };
  }

  async function handleInit(request: Request): Promise<Response> {
    const originErr = checkAllowedOrigin(request, allowedOrigins);
    if (originErr) return originErr;
    if (typeof storage.createMultipartUpload !== 'function') {
      return kitErrorResponse('Storage adapter does not support multipart uploads', 'STORAGE_ERROR', 501, false);
    }
    if (validateOnComplete && typeof storage.download !== 'function') {
      return kitErrorResponse(MISSING_DOWNLOAD_MESSAGE, 'STORAGE_ERROR', 501, false);
    }
    const { body, errorResponse } = await readBoundedJsonBody(request, 16_384);
    if (errorResponse || !body) return errorResponse!;

    const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
    const rawBucket = typeof body.bucket === 'string' && body.bucket ? body.bucket : undefined;
    const bucket = (allowClientBucketOverride ? rawBucket : undefined) || defaultBucket;
    const rawFolder = typeof body.folder === 'string' ? sanitizeFolderSegment(body.folder) : '';
    const clientPath = typeof body.path === 'string' ? sanitizeFolderSegment(body.path) : '';
    const targetPath = allowClientPathOverride
      ? clientPath
      : `${rawFolder ? `${rawFolder}/` : ''}${generateId()}.${mimeToExtension(contentType)}`;
    const declaredSize = body.totalSize !== undefined && body.totalSize !== null ? Number(body.totalSize) : undefined;

    const authCtx: AuthorizeContext = { action: 'upload', request, bucket, path: targetPath };
    const access = await guardRouteAccess(options, authCtx, 'upload', declaredSize);
    if (access.errorResponse) return access.errorResponse;
    const quotaErr = await enforceQuota(options, { action: 'upload', request, subject: access.subject, bytes: declaredSize && declaredSize > 0 ? declaredSize : 0, bucket });
    if (quotaErr) return quotaErr;

    if (rawBucket && allowedBuckets && !allowedBuckets.includes(rawBucket)) {
      return kitErrorResponse(`Bucket "${rawBucket}" is not allowed`, 'FORBIDDEN', 403, false);
    }
    if (!targetPath || !contentType) {
      return kitErrorResponse('Missing required "path" or "contentType"', 'INVALID_IMAGE', 400, false);
    }
    if (declaredSize !== undefined && (!Number.isFinite(declaredSize) || declaredSize <= 0)) {
      return kitErrorResponse('Invalid totalSize', 'INVALID_IMAGE', 400, false);
    }
    if (declaredSize !== undefined && declaredSize > maxTotalBytes) {
      return kitErrorResponse(`Upload exceeds maximum total size of ${maxTotalBytes} bytes`, 'FILE_TOO_LARGE', 413, false);
    }
    const maxMB = maxTotalBytes / (1024 * 1024);
    const formatCheck = validateImageFileStrict({ size: declaredSize ?? 1, type: contentType }, maxMB, allowedFormats);
    if (!formatCheck.valid) return kitErrorResponse(formatCheck.error || 'Unsupported format', 'UNSUPPORTED_FORMAT', 400, false);

    const created = await storage.createMultipartUpload({ bucket, path: targetPath, contentType, metadata: sanitizeMetadataRecord(body.metadata) });
    const createdAt = now();
    await store.create({
      uploadId: created.uploadId, bucket: created.bucket, path: created.path, receivedBytes: 0, partSizes: {},
      createdAt, expiresAt: createdAt + sessionTtlMs, ...(access.subject ? { subject: access.subject } : {}),
    });
    return jsonResponse(created, 200);
  }

  async function handlePart(request: Request): Promise<Response> {
    if (typeof storage.uploadPart !== 'function') {
      return kitErrorResponse('Storage adapter does not support multipart part uploads', 'STORAGE_ERROR', 501, false);
    }
    const { searchParams } = new URL(request.url, 'http://localhost');
    const partNumber = Number(searchParams.get('partNumber'));
    const { session, subject, errorResponse } = await guardSession(request, searchParams.get('uploadId') || '', 'upload');
    if (errorResponse || !session) return errorResponse!;
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      return kitErrorResponse('partNumber must be a positive integer', 'INVALID_IMAGE', 400, false);
    }
    const priorBytes = bytesExcludingPart(session, partNumber);
    if (priorBytes >= maxTotalBytes) {
      return kitErrorResponse('Multipart upload exceeds maximum total size', 'FILE_TOO_LARGE', 413, false);
    }
    const limit = Math.min(maxPartBytes, maxTotalBytes - priorBytes);
    const { bytes, errorResponse: readErr } = await readBoundedStreamBytes(request, limit, 'Part exceeds maximum allowed size');
    if (readErr || !bytes) return readErr!;
    if (bytes.byteLength === 0) return kitErrorResponse('Multipart part body is empty', 'INVALID_IMAGE', 400, false);

    const deltaBytes = Math.max(0, bytes.byteLength - (session.partSizes?.[partNumber] ?? 0));
    const quotaErr = await enforceQuota(options, { action: 'upload', request, subject, bytes: deltaBytes, bucket: session.bucket });
    if (quotaErr) return quotaErr;

    const uploaded = await storage.uploadPart({ bucket: session.bucket, path: session.path, uploadId: session.uploadId, partNumber, data: bytes });
    if (typeof store.recordPart === 'function') {
      await store.recordPart(session.uploadId, partNumber, bytes.byteLength);
    } else {
      await store.addBytes?.(session.uploadId, bytes.byteLength);
    }
    return jsonResponse(uploaded, 200);
  }

  async function handleComplete(request: Request): Promise<Response> {
    if (typeof storage.completeMultipartUpload !== 'function') {
      return kitErrorResponse('Storage adapter does not support completing multipart uploads', 'STORAGE_ERROR', 501, false);
    }
    if (validateOnComplete && typeof storage.download !== 'function') {
      return kitErrorResponse(MISSING_DOWNLOAD_MESSAGE, 'STORAGE_ERROR', 501, false);
    }
    const { body, errorResponse: bodyErr } = await readBoundedJsonBody(request, 65_536);
    if (bodyErr || !body) return bodyErr!;
    const { session, subject, errorResponse } = await guardSession(request, typeof body.uploadId === 'string' ? body.uploadId : '', 'upload');
    if (errorResponse || !session) return errorResponse!;
    const parts = parsePartsList(body.parts);
    if (!parts) return kitErrorResponse('Invalid or empty multipart "parts" list', 'INVALID_IMAGE', 400, false);

    const result = await storage.completeMultipartUpload({ bucket: session.bucket, path: session.path, uploadId: session.uploadId, parts });
    await store.delete(session.uploadId);

    const targetBucket = result.bucket || session.bucket;
    const targetPath = result.path || session.path;
    let finalBytes = session.receivedBytes;
    if (validateOnComplete) {
      let downloaded: Uint8Array;
      try {
        downloaded = await storage.download!(targetBucket, targetPath, { maxBytes: maxTotalBytes });
      } catch (dlErr) {
        if (dlErr instanceof Error && dlErr.message.includes('exceeds maximum allowed')) {
          await deleteRejectedObject(targetBucket, targetPath, request);
          return kitErrorResponse(dlErr.message, 'FILE_TOO_LARGE', 413, false);
        }
        throw dlErr;
      }
      if (downloaded.byteLength > maxTotalBytes) {
        await deleteRejectedObject(targetBucket, targetPath, request);
        return kitErrorResponse(`Upload exceeds maximum total size of ${maxTotalBytes} bytes`, 'FILE_TOO_LARGE', 413, false);
      }
      try {
        assertMagicBytesAllowed(downloaded, allowedFormats, false);
      } catch (valErr) {
        await deleteRejectedObject(targetBucket, targetPath, request);
        const msg = valErr instanceof Error ? valErr.message : 'Multipart object failed image content validation';
        return kitErrorResponse(msg, 'INVALID_IMAGE', 400, false);
      }
      finalBytes = downloaded.byteLength;
    }

    await recordQuotaUsage(options, { action: 'finalize', request, subject, bytes: finalBytes, bucket: targetBucket });
    return jsonResponse(result, 200);
  }

  async function handleAbort(request: Request, uploadId: string): Promise<Response> {
    if (typeof storage.abortMultipartUpload !== 'function') {
      return kitErrorResponse('Storage adapter does not support aborting multipart uploads', 'STORAGE_ERROR', 501, false);
    }
    const { session, errorResponse } = await guardSession(request, uploadId, 'delete');
    if (errorResponse || !session) return errorResponse!;
    await storage.abortMultipartUpload({ bucket: session.bucket, path: session.path, uploadId: session.uploadId });
    await store.delete(session.uploadId);
    return jsonResponse({ aborted: true, uploadId: session.uploadId }, 200);
  }

  async function POST(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      const action = searchParams.get('action');
      if (action === 'init') return await handleInit(request);
      if (action === 'part') return await handlePart(request);
      if (action === 'complete') return await handleComplete(request);
      if (action === 'abort') return await handleAbort(request, searchParams.get('uploadId') || '');
      return kitErrorResponse('Unsupported multipart action', 'INVALID_IMAGE', 400, false);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'upload', request }, onError);
    }
  }

  async function PUT(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      if (searchParams.get('action') !== 'part') return kitErrorResponse('Unsupported multipart action', 'INVALID_IMAGE', 400, false);
      return await handlePart(request);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'upload', request }, onError);
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      if (searchParams.get('action') !== 'abort') return kitErrorResponse('Unsupported multipart action', 'INVALID_IMAGE', 400, false);
      return await handleAbort(request, searchParams.get('uploadId') || '');
    } catch (error) {
      return handleUnexpectedError(error, { action: 'delete', request }, onError);
    }
  }

  return { POST, PUT, DELETE };
}
