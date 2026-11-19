import type { UploadedImageData } from '../types';
import {
  createCancelledUploadError,
  createNetworkUploadError,
  isAbortUploadError,
  parseClientUploadError,
} from './errors';
import { type RetryOptions, withRetry } from './retry';

export interface ResumableUploadProgress {
  loaded: number;
  total: number;
  percent: number;
  sessionId: string;
  offset: number;
}

export interface ResumableSessionInitInfo {
  sessionId: string;
  chunkSize: number;
  totalSize: number;
  offset: number;
  expiresAt: string;
}

export interface ResumableUploadOptions {
  filename?: string;
  contentType?: string;
  /** Chunk size in bytes (default: 1 MB = 1_048_576). */
  chunkSize?: number;
  /** Existing session ID to resume from after an interruption. */
  sessionId?: string;
  /** Byte offset to resume from when `sessionId` is provided (default: `0`). */
  offset?: number;
  preset?: string;
  bucket?: string;
  folder?: string;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  signal?: AbortSignal;
  retry?: RetryOptions;
  fetch?: typeof globalThis.fetch;
  onSessionCreated?: (session: ResumableSessionInitInfo) => void;
  onProgress?: (progress: ResumableUploadProgress) => void;
}

const DEFAULT_CHUNK_SIZE = 1024 * 1024;

function buildActionUrl(
  endpoint: string,
  params: Record<string, string>,
): string {
  const sep = endpoint.includes('?') ? '&' : '?';
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${endpoint}${sep}${query}`;
}

async function computeSha256Hex(chunk: Uint8Array): Promise<string> {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

async function readChunkBytes(
  source: Blob | File | Uint8Array,
  start: number,
  end: number,
): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source.subarray(start, end);
  }
  const buf = await source.slice(start, end).arrayBuffer();
  return new Uint8Array(buf);
}

async function performRequest(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw createCancelledUploadError();
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal });
  } catch (err) {
    if (signal?.aborted || isAbortUploadError(err)) {
      throw createCancelledUploadError();
    }
    throw createNetworkUploadError(
      err instanceof Error ? err.message : 'Network error during resumable upload',
      err,
    );
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw parseClientUploadError(res.status, text);
  }
  return text;
}

/**
 * Uploads a `Blob`, `File`, or `Uint8Array` in resumable chunks with per-chunk WebCrypto SHA-256
 * checksums, retryable failure recovery via `withRetry`, progress reporting, and `AbortSignal` support.
 */
export async function uploadResumable(
  endpoint: string,
  source: Blob | File | Uint8Array,
  options: ResumableUploadOptions = {},
): Promise<UploadedImageData> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const signal = options.signal;
  if (signal?.aborted) {
    throw createCancelledUploadError();
  }

  const totalSize = source instanceof Uint8Array ? source.byteLength : source.size;
  const filename =
    options.filename ??
    (typeof File !== 'undefined' && source instanceof File
      ? source.name
      : 'upload.bin');
  const contentType =
    options.contentType ??
    (typeof Blob !== 'undefined' && source instanceof Blob && source.type
      ? source.type
      : 'application/octet-stream');
  const requestedChunkSize = Math.max(
    1,
    Math.floor(options.chunkSize ?? DEFAULT_CHUNK_SIZE),
  );
  const credentials: RequestCredentials = options.withCredentials
    ? 'include'
    : 'same-origin';
  const retryOpts: RetryOptions = {
    ...options.retry,
    signal,
  };

  let sessionId = options.sessionId;
  let chunkSize = requestedChunkSize;
  let offset = Math.max(0, Math.floor(options.offset ?? 0));

  if (!sessionId) {
    const initUrl = buildActionUrl(endpoint, { action: 'init' });
    const initText = await withRetry(
      () =>
        performRequest(
          fetchImpl,
          initUrl,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(options.headers ?? {}),
            },
            credentials,
            body: JSON.stringify({
              filename,
              contentType,
              totalSize,
              chunkSize: requestedChunkSize,
              ...(options.preset ? { preset: options.preset } : {}),
              ...(options.bucket ? { bucket: options.bucket } : {}),
              ...(options.folder ? { folder: options.folder } : {}),
            }),
          },
          signal,
        ),
      retryOpts,
    );
    const initPayload = JSON.parse(initText) as ResumableSessionInitInfo;
    sessionId = initPayload.sessionId;
    chunkSize = Math.max(1, initPayload.chunkSize || requestedChunkSize);
    offset = initPayload.offset ?? 0;
    options.onSessionCreated?.(initPayload);
  }

  while (offset < totalSize) {
    if (signal?.aborted) {
      throw createCancelledUploadError();
    }
    const end = Math.min(totalSize, offset + chunkSize);
    const chunk = await readChunkBytes(source, offset, end);
    const sha256 = await computeSha256Hex(chunk);
    const chunkUrl = buildActionUrl(endpoint, {
      action: 'chunk',
      sessionId,
      offset: String(offset),
    });

    const bodyCopy = new Uint8Array(chunk.byteLength);
    bodyCopy.set(chunk);

    await withRetry(
      () =>
        performRequest(
          fetchImpl,
          chunkUrl,
          {
            method: 'PATCH',
            headers: {
              'content-type': 'application/octet-stream',
              'x-chunk-sha256': sha256,
              ...(options.headers ?? {}),
            },
            credentials,
            body: bodyCopy,
          },
          signal,
        ),
      retryOpts,
    );

    offset = end;
    options.onProgress?.({
      loaded: offset,
      total: totalSize,
      percent: totalSize > 0 ? Math.round((offset / totalSize) * 100) : 100,
      sessionId,
      offset,
    });
  }

  const completeUrl = buildActionUrl(endpoint, {
    action: 'complete',
    sessionId,
  });
  const completeText = await withRetry(
    () =>
      performRequest(
        fetchImpl,
        completeUrl,
        {
          method: 'POST',
          headers: { ...(options.headers ?? {}) },
          credentials,
        },
        signal,
      ),
    retryOpts,
  );

  return JSON.parse(completeText) as UploadedImageData;
}

/**
 * Aborts an in-progress resumable upload session and frees server-side chunks.
 */
export async function abortResumableUpload(
  endpoint: string,
  sessionId: string,
  options: Pick<ResumableUploadOptions, 'headers' | 'withCredentials' | 'fetch'> = {},
): Promise<void> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const abortUrl = buildActionUrl(endpoint, { action: 'abort', sessionId });
  await performRequest(fetchImpl, abortUrl, {
    method: 'DELETE',
    headers: { ...(options.headers ?? {}) },
    credentials: options.withCredentials ? 'include' : 'same-origin',
  });
}
