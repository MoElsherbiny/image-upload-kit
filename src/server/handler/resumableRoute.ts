import { DEFAULT_ALLOWED_FORMATS } from '../../types';
import { type UploadErrorCode, UploadKitError } from '../../types/errors';
import { validateImageFileStrict } from '../../utils/validators';
import { checkAllowedOrigin, runAuthorize, sanitizeFolderSegment } from './guards';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import { readBoundedJsonBody } from './presignRoute';
import { resolveSubject } from './rateLimitGuard';
import { errorResponseFromKitError, handleUnexpectedError, jsonResponse } from './responses';

export interface ResumableSessionRecord {
  id: string;
  subject?: string;
  filename: string;
  contentType: string;
  totalSize: number;
  chunkSize: number;
  receivedBytes: number;
  bucket?: string;
  folder?: string;
  preset?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ResumableSessionStore {
  create(session: ResumableSessionRecord): Promise<void> | void;
  get(sessionId: string): Promise<ResumableSessionRecord | null | undefined> | ResumableSessionRecord | null | undefined;
  appendChunk(sessionId: string, offset: number, data: Uint8Array): Promise<ResumableSessionRecord> | ResumableSessionRecord;
  assemble(sessionId: string): Promise<Uint8Array> | Uint8Array;
  delete(sessionId: string): Promise<void> | void;
  listExpired?(now: number, maxAgeMs?: number): Promise<ResumableSessionRecord[]> | ResumableSessionRecord[];
  listAll?(): Promise<ResumableSessionRecord[]> | ResumableSessionRecord[];
}

export interface ResumableUploadHandlerOptions<TPreset extends string = string>
  extends Pick<
    UploadHttpHandlerOptions<TPreset>,
    'uploader' | 'authorize' | 'getSubject' | 'allowedOrigins' | 'allowedPresets' | 'allowedBuckets' | 'allowClientBucketOverride' | 'onError'
  > {
  store?: ResumableSessionStore;
  defaultChunkSize?: number;
  maxChunkSize?: number;
  sessionTtlMs?: number;
  now?: () => number;
}

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_MAX_CHUNK_SIZE = 10 * 1024 * 1024;
const DEFAULT_SESSION_TTL_MS = 3_600_000;

function kitErr(message: string, code: UploadErrorCode, status: number): Response {
  return errorResponseFromKitError(new UploadKitError(message, { code, status }));
}

function generateSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readBoundedBytes(request: Request, maxBytes: number): Promise<{ bytes?: Uint8Array; errorResponse?: Response }> {
  const clRaw = request.headers.get('content-length');
  if (clRaw !== null && clRaw.trim() !== '' && Number.isFinite(Number(clRaw)) && Number(clRaw) > maxBytes) {
    return { errorResponse: kitErr('Chunk size exceeds allowed limit', 'FILE_TOO_LARGE', 413) };
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength > maxBytes) return { errorResponse: kitErr('Chunk size exceeds allowed limit', 'FILE_TOO_LARGE', 413) };
  return { bytes: buf };
}

/** Dev/single-instance in-memory `ResumableSessionStore`. */
export function createMemoryResumableSessionStore(): ResumableSessionStore {
  const sessions = new Map<string, { record: ResumableSessionRecord; chunks: Map<number, Uint8Array> }>();

  return {
    create(session) {
      sessions.set(session.id, { record: { ...session }, chunks: new Map() });
    },
    get(sessionId) {
      const entry = sessions.get(sessionId);
      return entry ? { ...entry.record } : null;
    },
    appendChunk(sessionId, offset, data) {
      const entry = sessions.get(sessionId);
      if (!entry) throw new UploadKitError('Resumable upload session not found', { code: 'INVALID_UPLOAD_TOKEN', status: 404 });
      entry.chunks.set(offset, new Uint8Array(data));
      let end = 0;
      for (const off of [...entry.chunks.keys()].sort((a, b) => a - b)) {
        if (off > end) break;
        end = Math.max(end, off + entry.chunks.get(off)!.byteLength);
      }
      entry.record.receivedBytes = end;
      return { ...entry.record };
    },
    assemble(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) throw new UploadKitError('Resumable upload session not found', { code: 'INVALID_UPLOAD_TOKEN', status: 404 });
      const merged = new Uint8Array(entry.record.totalSize);
      let cursor = 0;
      for (const off of [...entry.chunks.keys()].sort((a, b) => a - b)) {
        if (off !== cursor) throw new UploadKitError('Resumable upload has missing chunk range', { code: 'INVALID_IMAGE', status: 400 });
        const chunk = entry.chunks.get(off)!;
        merged.set(chunk, off);
        cursor += chunk.byteLength;
      }
      if (cursor !== entry.record.totalSize) {
        throw new UploadKitError('Resumable upload is incomplete', { code: 'INVALID_IMAGE', status: 400 });
      }
      return merged;
    },
    delete(sessionId) {
      sessions.delete(sessionId);
    },
    listExpired(now, maxAgeMs) {
      const expired: ResumableSessionRecord[] = [];
      for (const { record } of sessions.values()) {
        if (record.expiresAt <= now || (maxAgeMs !== undefined && now - record.createdAt >= maxAgeMs)) {
          expired.push({ ...record });
        }
      }
      return expired;
    },
    listAll() {
      return [...sessions.values()].map(({ record }) => ({ ...record }));
    },
  };
}

/** Creates Web Fetch handlers (`POST`, `PATCH`, `DELETE`) for resumable chunked uploads. */
export function createResumableUploadHandler<TPreset extends string = string>(
  options: ResumableUploadHandlerOptions<TPreset>,
) {
  const { uploader, authorize, getSubject, allowedOrigins, onError } = options;
  const store = options.store ?? createMemoryResumableSessionStore();
  const defaultChunkSize = options.defaultChunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxChunkSize = options.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const now = options.now ?? (() => Date.now());

  async function guardSession(
    request: Request,
    sessionId: string,
    action: 'upload' | 'delete',
  ): Promise<{ session?: ResumableSessionRecord; errorResponse?: Response }> {
    const originErr = checkAllowedOrigin(request, allowedOrigins);
    if (originErr) return { errorResponse: originErr };
    const authCtx: AuthorizeContext = { action, request };
    const authErr = await runAuthorize(authorize, authCtx);
    if (authErr) return { errorResponse: authErr };
    const subject = await resolveSubject(getSubject, authCtx);
    const session = await store.get(sessionId);
    if (!session) return { errorResponse: kitErr('Resumable upload session not found', 'INVALID_UPLOAD_TOKEN', 404) };
    if (session.subject !== undefined && session.subject !== subject) {
      return { errorResponse: kitErr('Session subject mismatch', 'FORBIDDEN', 403) };
    }
    if (action === 'upload' && now() > session.expiresAt) {
      await store.delete(session.id);
      return { errorResponse: kitErr('Resumable upload session expired', 'UPLOAD_EXPIRED', 410) };
    }
    return { session };
  }

  async function handleInit(request: Request): Promise<Response> {
    const originErr = checkAllowedOrigin(request, allowedOrigins);
    if (originErr) return originErr;
    const { body, errorResponse } = await readBoundedJsonBody(request, 16_384);
    if (errorResponse || !body) return errorResponse!;

    const preset = typeof body.preset === 'string' && body.preset ? (body.preset as TPreset) : undefined;
    const rawBucket = typeof body.bucket === 'string' && body.bucket ? body.bucket : undefined;
    const folder = typeof body.folder === 'string' ? sanitizeFolderSegment(body.folder) : undefined;
    const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'upload.bin';
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
    const totalSize = Number(body.totalSize);
    const reqChunk = body.chunkSize !== undefined ? Number(body.chunkSize) : defaultChunkSize;

    const authCtx: AuthorizeContext = { action: 'upload', request, bucket: rawBucket, preset, path: folder };
    const authErr = await runAuthorize(authorize, authCtx);
    if (authErr) return authErr;
    const subject = await resolveSubject(getSubject, authCtx);

    if (preset && options.allowedPresets && !options.allowedPresets.includes(preset)) {
      return kitErr(`Invalid preset "${preset}"`, 'INVALID_IMAGE', 400);
    }
    if (rawBucket && options.allowedBuckets && !options.allowedBuckets.includes(rawBucket)) {
      return kitErr(`Bucket "${rawBucket}" is not allowed`, 'FORBIDDEN', 403);
    }
    if (!contentType || !Number.isFinite(totalSize) || totalSize <= 0) {
      return kitErr('Invalid contentType or totalSize', 'INVALID_IMAGE', 400);
    }

    const limits = uploader.resolveUploadLimits?.(preset) ?? {
      maxSizeMB: uploader.getMaxSizeMB?.(preset ? [preset] : options.allowedPresets) ?? 10,
      allowedFormats: DEFAULT_ALLOWED_FORMATS,
      allowSvg: false,
      defaultFolder: '',
    };
    const maxBytes = Math.floor(limits.maxSizeMB * 1024 * 1024);
    if (totalSize > maxBytes) return kitErr(`File exceeds max size of ${maxBytes} bytes`, 'FILE_TOO_LARGE', 413);
    const check = validateImageFileStrict({ size: totalSize, type: contentType }, limits.maxSizeMB, limits.allowedFormats);
    if (!check.valid) return kitErr(check.error || 'Unsupported format', 'UNSUPPORTED_FORMAT', 400);

    const chunkSize = Math.max(1, Math.min(maxChunkSize, Math.floor(Number.isFinite(reqChunk) && reqChunk > 0 ? reqChunk : defaultChunkSize)));
    const createdAt = now();
    const expiresAt = createdAt + sessionTtlMs;
    const bucket = (options.allowClientBucketOverride ? rawBucket : undefined) || uploader.defaultBucket;
    const record: ResumableSessionRecord = {
      id: generateSessionId(),
      filename,
      contentType,
      totalSize: Math.floor(totalSize),
      chunkSize,
      receivedBytes: 0,
      createdAt,
      expiresAt,
      ...(subject ? { subject } : {}),
      ...(bucket ? { bucket } : {}),
      ...(folder ? { folder } : {}),
      ...(preset ? { preset } : {}),
    };
    await store.create(record);
    return jsonResponse({ sessionId: record.id, chunkSize, totalSize: record.totalSize, offset: 0, expiresAt: new Date(expiresAt).toISOString() }, 201);
  }

  async function POST(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      const action = searchParams.get('action');
      if (action === 'init') return await handleInit(request);
      if (action === 'complete') {
        const { session, errorResponse } = await guardSession(request, searchParams.get('sessionId') || '', 'upload');
        if (errorResponse || !session) return errorResponse!;
        if (session.receivedBytes !== session.totalSize) {
          return kitErr('Resumable upload is incomplete', 'INVALID_IMAGE', 400);
        }
        const assembled = await store.assemble(session.id);
        try {
          const result = await uploader.uploadImage(
            { buffer: Buffer.from(assembled.buffer, assembled.byteOffset, assembled.byteLength), name: session.filename, type: session.contentType, size: assembled.byteLength },
            { preset: session.preset as TPreset | undefined, bucket: session.bucket, folder: session.folder, signal: request.signal },
          );
          return jsonResponse(result, 200);
        } finally {
          await store.delete(session.id);
        }
      }
      return kitErr('Unsupported resumable action', 'INVALID_IMAGE', 400);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'upload', request }, onError);
    }
  }

  async function PATCH(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      if (searchParams.get('action') !== 'chunk') return kitErr('Unsupported resumable action', 'INVALID_IMAGE', 400);
      const offset = Number(searchParams.get('offset'));
      const { session, errorResponse } = await guardSession(request, searchParams.get('sessionId') || '', 'upload');
      if (errorResponse || !session) return errorResponse!;
      if (!Number.isInteger(offset) || offset < 0 || offset > session.receivedBytes) {
        return kitErr('Invalid chunk offset', 'INVALID_IMAGE', 400);
      }
      const { bytes, errorResponse: readErr } = await readBoundedBytes(request, Math.min(maxChunkSize, session.totalSize - offset));
      if (readErr || !bytes) return readErr!;
      const expectedSha = request.headers.get('x-chunk-sha256')?.trim().toLowerCase();
      if (expectedSha && (await sha256Hex(bytes)) !== expectedSha) {
        return kitErr('Chunk SHA-256 checksum mismatch', 'INVALID_IMAGE', 400);
      }
      const updated = await store.appendChunk(session.id, offset, bytes);
      return jsonResponse({ sessionId: updated.id, offset: updated.receivedBytes, receivedBytes: updated.receivedBytes, totalSize: updated.totalSize }, 200);
    } catch (error) {
      return handleUnexpectedError(error, { action: 'upload', request }, onError);
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      if (searchParams.get('action') !== 'abort') return kitErr('Unsupported resumable action', 'INVALID_IMAGE', 400);
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
