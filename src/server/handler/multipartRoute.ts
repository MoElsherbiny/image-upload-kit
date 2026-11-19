import type { StorageAdapter, StorageMultipartPartResult } from '../../storage/types';
import { DEFAULT_ALLOWED_FORMATS } from '../../types';
import { UploadKitError } from '../../types/errors';
import { validateImageFileStrict } from '../../utils/validators';
import {
  checkAllowedOrigin,
  generateId,
  guardRouteAccess,
  kitErrorResponse,
  mimeToExtension,
  sanitizeFolderSegment,
  sanitizeMetadataRecord,
} from './guards';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import { enforceQuota, recordQuotaUsage } from './rateLimitGuard';
import { handleUnexpectedError, jsonResponse } from './responses';
import { readBoundedJsonBody, readBoundedStreamBytes } from './streamBody';

export interface MultipartSessionRecord {
  uploadId: string;
  bucket: string;
  path: string;
  subject?: string;
  receivedBytes: number;
  createdAt: number;
  expiresAt: number;
}

export interface MultipartSessionStore {
  create(session: MultipartSessionRecord): Promise<void> | void;
  get(uploadId: string): Promise<MultipartSessionRecord | null | undefined> | MultipartSessionRecord | null | undefined;
  addBytes?(uploadId: string, bytes: number): Promise<MultipartSessionRecord | null | undefined> | MultipartSessionRecord | null | undefined;
  delete(uploadId: string): Promise<void> | void;
}

export interface MemoryMultipartSessionStoreOptions {
  maxSessions?: number;
  ttlMs?: number;
  now?: () => number;
}

export interface MultipartUploadHandlerOptions
  extends Pick<
    UploadHttpHandlerOptions,
    | 'authorize' | 'getSubject' | 'allowedOrigins' | 'allowedBuckets'
    | 'allowClientBucketOverride' | 'rateLimiter' | 'quotaProvider' | 'rateLimitKey' | 'onError'
  > {
  storage: StorageAdapter;
  store?: MultipartSessionStore;
  defaultBucket?: string;
  maxPartBytes?: number;
  maxTotalBytes?: number;
  allowedFormats?: string[];
  allowClientPathOverride?: boolean;
  sessionTtlMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_PART_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 500;
const DEFAULT_SESSION_TTL_MS = 3_600_000;
const DEFAULT_MULTIPART_ALLOWED_FORMATS = [...DEFAULT_ALLOWED_FORMATS, 'application/octet-stream'];

function parsePartsList(raw: unknown): StorageMultipartPartResult[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const parts: StorageMultipartPartResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const { partNumber, etag } = item as { partNumber?: unknown; etag?: unknown };
    if (typeof partNumber !== 'number' || !Number.isInteger(partNumber) || partNumber < 1 || typeof etag !== 'string' || etag.trim().length === 0) {
      return null;
    }
    parts.push({ partNumber, etag });
  }
  return parts;
}

/** Dev/single-instance bounded TTL-evicting in-memory `MultipartSessionStore`. */
export function createMemoryMultipartSessionStore(
  options: MemoryMultipartSessionStoreOptions = {},
): MultipartSessionStore {
  const maxSessions = Math.max(1, Math.floor(options.maxSessions ?? DEFAULT_MAX_SESSIONS));
  const ttlMs = Math.max(1, Math.floor(options.ttlMs ?? DEFAULT_SESSION_TTL_MS));
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, MultipartSessionRecord>();

  const pruneExpired = (): void => {
    const ts = now();
    for (const [id, entry] of sessions) {
      if (entry.expiresAt <= ts) sessions.delete(id);
    }
  };

  return {
    create(session) {
      pruneExpired();
      if (!sessions.has(session.uploadId) && sessions.size >= maxSessions) {
        throw new UploadKitError('Maximum active multipart upload sessions reached', { code: 'RESOURCE_LIMIT_EXCEEDED', status: 503 });
      }
      const createdAt = session.createdAt || now();
      const expiresAt = session.expiresAt ? Math.min(session.expiresAt, createdAt + ttlMs) : createdAt + ttlMs;
      sessions.set(session.uploadId, { ...session, createdAt, expiresAt });
    },
    get(uploadId) {
      const entry = sessions.get(uploadId);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        sessions.delete(uploadId);
        return null;
      }
      return { ...entry };
    },
    addBytes(uploadId, bytes) {
      const entry = sessions.get(uploadId);
      if (!entry) return null;
      entry.receivedBytes += Math.max(0, bytes);
      return { ...entry };
    },
    delete(uploadId) {
      sessions.delete(uploadId);
    },
  };
}

/** Creates Web Fetch handlers (`POST`, `PUT`, `DELETE`) for S3-compatible multipart uploads. */
export function createMultipartUploadHandler(options: MultipartUploadHandlerOptions) {
  const { storage, allowedOrigins, allowedBuckets, allowClientBucketOverride = false, onError } = options;
  const defaultBucket = options.defaultBucket ?? 'images';
  const maxPartBytes = options.maxPartBytes ?? DEFAULT_MAX_PART_BYTES;
  const maxTotalBytes = options.maxTotalBytes;
  const allowedFormats = options.allowedFormats ?? DEFAULT_MULTIPART_ALLOWED_FORMATS;
  const allowClientPathOverride = options.allowClientPathOverride ?? true;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? createMemoryMultipartSessionStore({ ttlMs: sessionTtlMs, now });
  const limitOpts = {
    rateLimiter: options.rateLimiter,
    quotaProvider: options.quotaProvider,
    rateLimitKey: options.rateLimitKey,
  } as unknown as UploadHttpHandlerOptions;

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
    const quotaErr = await enforceQuota(limitOpts, { action: 'upload', request, subject: access.subject, bytes: declaredSize && declaredSize > 0 ? declaredSize : 0, bucket });
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
    if (maxTotalBytes !== undefined && declaredSize !== undefined && declaredSize > maxTotalBytes) {
      return kitErrorResponse(`Upload exceeds maximum total size of ${maxTotalBytes} bytes`, 'FILE_TOO_LARGE', 413, false);
    }
    const maxMB = maxTotalBytes !== undefined ? maxTotalBytes / (1024 * 1024) : Number.MAX_SAFE_INTEGER;
    const formatCheck = validateImageFileStrict({ size: declaredSize ?? 1, type: contentType }, maxMB, allowedFormats);
    if (!formatCheck.valid) return kitErrorResponse(formatCheck.error || 'Unsupported format', 'UNSUPPORTED_FORMAT', 400, false);

    const created = await storage.createMultipartUpload({ bucket, path: targetPath, contentType, metadata: sanitizeMetadataRecord(body.metadata) });
    const createdAt = now();
    await store.create({
      uploadId: created.uploadId, bucket: created.bucket, path: created.path, receivedBytes: 0,
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
    if (maxTotalBytes !== undefined && session.receivedBytes >= maxTotalBytes) {
      return kitErrorResponse('Multipart upload exceeds maximum total size', 'FILE_TOO_LARGE', 413, false);
    }
    const limit = maxTotalBytes !== undefined ? Math.min(maxPartBytes, maxTotalBytes - session.receivedBytes) : maxPartBytes;
    const { bytes, errorResponse: readErr } = await readBoundedStreamBytes(request, limit, 'Part exceeds maximum allowed size');
    if (readErr || !bytes) return readErr!;
    if (bytes.byteLength === 0) return kitErrorResponse('Multipart part body is empty', 'INVALID_IMAGE', 400, false);

    const quotaErr = await enforceQuota(limitOpts, { action: 'upload', request, subject, bytes: bytes.byteLength, bucket: session.bucket });
    if (quotaErr) return quotaErr;

    const uploaded = await storage.uploadPart({ bucket: session.bucket, path: session.path, uploadId: session.uploadId, partNumber, data: bytes });
    await store.addBytes?.(session.uploadId, bytes.byteLength);
    return jsonResponse(uploaded, 200);
  }

  async function handleComplete(request: Request): Promise<Response> {
    if (typeof storage.completeMultipartUpload !== 'function') {
      return kitErrorResponse('Storage adapter does not support completing multipart uploads', 'STORAGE_ERROR', 501, false);
    }
    const { body, errorResponse: bodyErr } = await readBoundedJsonBody(request, 65_536);
    if (bodyErr || !body) return bodyErr!;
    const { session, subject, errorResponse } = await guardSession(request, typeof body.uploadId === 'string' ? body.uploadId : '', 'upload');
    if (errorResponse || !session) return errorResponse!;
    const parts = parsePartsList(body.parts);
    if (!parts) return kitErrorResponse('Invalid or empty multipart "parts" list', 'INVALID_IMAGE', 400, false);

    const result = await storage.completeMultipartUpload({ bucket: session.bucket, path: session.path, uploadId: session.uploadId, parts });
    await store.delete(session.uploadId);
    await recordQuotaUsage(limitOpts, { action: 'finalize', request, subject, bytes: session.receivedBytes, bucket: session.bucket });
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
