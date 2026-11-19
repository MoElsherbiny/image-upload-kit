import type {
  StorageAdapter,
  StorageMultipartPartResult,
} from '../../storage/types';
import { type UploadErrorCode, UploadKitError } from '../../types/errors';
import {
  checkAllowedOrigin,
  runAuthorize,
  sanitizeFolderSegment,
} from './guards';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import { readBoundedJsonBody } from './presignRoute';
import { resolveSubject } from './rateLimitGuard';
import {
  errorResponseFromKitError,
  handleUnexpectedError,
  jsonResponse,
} from './responses';

export interface MultipartUploadHandlerOptions
  extends Pick<
    UploadHttpHandlerOptions,
    | 'authorize'
    | 'getSubject'
    | 'allowedOrigins'
    | 'allowedBuckets'
    | 'allowClientBucketOverride'
    | 'onError'
  > {
  storage: StorageAdapter;
  defaultBucket?: string;
  maxPartBytes?: number;
}

interface ActiveMultipartSession {
  uploadId: string;
  bucket: string;
  path: string;
  subject?: string;
}

const DEFAULT_MAX_PART_BYTES = 10 * 1024 * 1024;

function kitErr(
  message: string,
  code: UploadErrorCode,
  status: number,
  retryable?: boolean,
): Response {
  return errorResponseFromKitError(
    new UploadKitError(message, { code, status, retryable }),
  );
}

function sanitizeMetadata(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parsePartsList(raw: unknown): StorageMultipartPartResult[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const parts: StorageMultipartPartResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const { partNumber, etag } = item as { partNumber?: unknown; etag?: unknown };
    if (
      typeof partNumber !== 'number' ||
      !Number.isInteger(partNumber) ||
      partNumber < 1 ||
      typeof etag !== 'string' ||
      etag.trim().length === 0
    ) {
      return null;
    }
    parts.push({ partNumber, etag });
  }
  return parts;
}

/**
 * Creates Web Fetch handlers (`POST`, `PUT`, `DELETE`) for S3-compatible multipart uploads
 * backed by `StorageAdapter` multipart hooks.
 */
export function createMultipartUploadHandler(
  options: MultipartUploadHandlerOptions,
) {
  const {
    storage,
    authorize,
    getSubject,
    allowedOrigins,
    allowedBuckets,
    allowClientBucketOverride = false,
    onError,
  } = options;
  const defaultBucket = options.defaultBucket ?? 'images';
  const maxPartBytes = options.maxPartBytes ?? DEFAULT_MAX_PART_BYTES;
  const sessions = new Map<string, ActiveMultipartSession>();

  async function guardSession(
    request: Request,
    uploadId: string,
    action: 'upload' | 'delete',
  ): Promise<{ session?: ActiveMultipartSession; errorResponse?: Response }> {
    const originErr = checkAllowedOrigin(request, allowedOrigins);
    if (originErr) return { errorResponse: originErr };
    const authCtx: AuthorizeContext = { action, request };
    const authErr = await runAuthorize(authorize, authCtx);
    if (authErr) return { errorResponse: authErr };
    const subject = await resolveSubject(getSubject, authCtx);
    const session = sessions.get(uploadId);
    if (!session) {
      return {
        errorResponse: kitErr('Multipart upload session not found', 'INVALID_UPLOAD_TOKEN', 404),
      };
    }
    if (session.subject !== undefined && session.subject !== subject) {
      return {
        errorResponse: kitErr('Multipart upload subject mismatch', 'FORBIDDEN', 403),
      };
    }
    return { session };
  }

  async function handleInit(request: Request): Promise<Response> {
    const originErr = checkAllowedOrigin(request, allowedOrigins);
    if (originErr) return originErr;
    if (typeof storage.createMultipartUpload !== 'function') {
      return kitErr('Storage adapter does not support multipart uploads', 'STORAGE_ERROR', 501, false);
    }

    const { body, errorResponse } = await readBoundedJsonBody(request, 16_384);
    if (errorResponse || !body) return errorResponse!;

    const rawPath = typeof body.path === 'string' ? sanitizeFolderSegment(body.path) : '';
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
    const rawBucket = typeof body.bucket === 'string' && body.bucket ? body.bucket : undefined;
    const bucket = (allowClientBucketOverride ? rawBucket : undefined) || defaultBucket;

    const authCtx: AuthorizeContext = { action: 'upload', request, bucket, path: rawPath };
    const authErr = await runAuthorize(authorize, authCtx);
    if (authErr) return authErr;
    const subject = await resolveSubject(getSubject, authCtx);

    if (rawBucket && allowedBuckets && !allowedBuckets.includes(rawBucket)) {
      return kitErr(`Bucket "${rawBucket}" is not allowed`, 'FORBIDDEN', 403);
    }
    if (!rawPath || !contentType) {
      return kitErr('Missing required "path" or "contentType"', 'INVALID_IMAGE', 400);
    }

    const created = await storage.createMultipartUpload({
      bucket,
      path: rawPath,
      contentType,
      metadata: sanitizeMetadata(body.metadata),
    });
    sessions.set(created.uploadId, {
      uploadId: created.uploadId,
      bucket: created.bucket,
      path: created.path,
      ...(subject ? { subject } : {}),
    });
    return jsonResponse(created, 200);
  }

  async function handlePart(request: Request): Promise<Response> {
    if (typeof storage.uploadPart !== 'function') {
      return kitErr('Storage adapter does not support multipart part uploads', 'STORAGE_ERROR', 501, false);
    }
    const { searchParams } = new URL(request.url, 'http://localhost');
    const uploadId = searchParams.get('uploadId') || '';
    const partNumber = Number(searchParams.get('partNumber'));
    const { session, errorResponse } = await guardSession(request, uploadId, 'upload');
    if (errorResponse || !session) return errorResponse!;

    if (!Number.isInteger(partNumber) || partNumber < 1) {
      return kitErr('partNumber must be a positive integer', 'INVALID_IMAGE', 400);
    }
    const clRaw = request.headers.get('content-length');
    if (clRaw !== null && clRaw.trim() !== '') {
      const cl = Number(clRaw);
      if (Number.isFinite(cl) && cl > maxPartBytes) {
        return kitErr('Part exceeds maximum allowed size', 'FILE_TOO_LARGE', 413);
      }
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return kitErr('Multipart part body is empty', 'INVALID_IMAGE', 400);
    }
    if (bytes.byteLength > maxPartBytes) {
      return kitErr('Part exceeds maximum allowed size', 'FILE_TOO_LARGE', 413);
    }

    const uploaded = await storage.uploadPart({
      bucket: session.bucket,
      path: session.path,
      uploadId: session.uploadId,
      partNumber,
      data: bytes,
    });
    return jsonResponse(uploaded, 200);
  }

  async function handleComplete(request: Request): Promise<Response> {
    if (typeof storage.completeMultipartUpload !== 'function') {
      return kitErr('Storage adapter does not support completing multipart uploads', 'STORAGE_ERROR', 501, false);
    }
    const { body, errorResponse: bodyErr } = await readBoundedJsonBody(request, 65_536);
    if (bodyErr || !body) return bodyErr!;

    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
    const { session, errorResponse } = await guardSession(request, uploadId, 'upload');
    if (errorResponse || !session) return errorResponse!;

    const parts = parsePartsList(body.parts);
    if (!parts) {
      return kitErr('Invalid or empty multipart "parts" list', 'INVALID_IMAGE', 400);
    }

    const result = await storage.completeMultipartUpload({
      bucket: session.bucket,
      path: session.path,
      uploadId: session.uploadId,
      parts,
    });
    sessions.delete(session.uploadId);
    return jsonResponse(result, 200);
  }

  async function handleAbort(request: Request, uploadId: string): Promise<Response> {
    if (typeof storage.abortMultipartUpload !== 'function') {
      return kitErr('Storage adapter does not support aborting multipart uploads', 'STORAGE_ERROR', 501, false);
    }
    const { session, errorResponse } = await guardSession(request, uploadId, 'delete');
    if (errorResponse || !session) return errorResponse!;

    await storage.abortMultipartUpload({
      bucket: session.bucket,
      path: session.path,
      uploadId: session.uploadId,
    });
    sessions.delete(session.uploadId);
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
      return kitErr('Unsupported multipart action', 'INVALID_IMAGE', 400);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'upload', request }, onError);
    }
  }

  async function PUT(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      if (searchParams.get('action') !== 'part') {
        return kitErr('Unsupported multipart action', 'INVALID_IMAGE', 400);
      }
      return await handlePart(request);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'upload', request }, onError);
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      if (searchParams.get('action') !== 'abort') {
        return kitErr('Unsupported multipart action', 'INVALID_IMAGE', 400);
      }
      return await handleAbort(request, searchParams.get('uploadId') || '');
    } catch (error) {
      return handleUnexpectedError(error, { action: 'delete', request }, onError);
    }
  }

  return { POST, PUT, DELETE };
}
