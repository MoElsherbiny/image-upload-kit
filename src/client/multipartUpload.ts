import type {
  StorageMultipartCreateResult,
  StorageMultipartPartResult,
  StorageUploadResult,
} from '../storage/types';
import {
  createCancelledUploadError,
  createNetworkUploadError,
  isAbortUploadError,
  parseClientUploadError,
} from './errors';
import { type RetryOptions, withRetry } from './retry';

export interface MultipartUploadProgress {
  loaded: number;
  total: number;
  percent: number;
  completedParts: number;
  totalParts: number;
}

export interface MultipartUploadOptions {
  path: string;
  contentType?: string;
  bucket?: string;
  metadata?: Record<string, string>;
  /** Size of each part in bytes (default: 5 MB = 5_242_880). */
  partSize?: number;
  /** Maximum concurrent part uploads (default: `3`). */
  concurrency?: number;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  signal?: AbortSignal;
  retry?: RetryOptions;
  fetch?: typeof globalThis.fetch;
  onProgress?: (progress: MultipartUploadProgress) => void;
}

const DEFAULT_PART_SIZE = 5 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 3;

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

async function readSlice(
  source: Blob | File | Uint8Array,
  start: number,
  end: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (source instanceof Uint8Array) {
    const slice = source.subarray(start, end);
    const copy = new Uint8Array(slice.byteLength);
    copy.set(slice);
    return copy;
  }
  return new Uint8Array(await source.slice(start, end).arrayBuffer());
}

async function requestText(
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
      err instanceof Error ? err.message : 'Network error during multipart upload',
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
 * Uploads a `Blob`, `File`, or `Uint8Array` via S3-compatible multipart endpoints
 * with bounded concurrency, per-part `withRetry` recovery, `AbortSignal` cancellation,
 * and automatic `abort` cleanup on failure or cancellation.
 */
export async function uploadMultipart(
  endpoint: string,
  source: Blob | File | Uint8Array,
  options: MultipartUploadOptions,
): Promise<StorageUploadResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const signal = options.signal;
  if (signal?.aborted) {
    throw createCancelledUploadError();
  }

  const totalSize = source instanceof Uint8Array ? source.byteLength : source.size;
  const contentType =
    options.contentType ??
    (typeof Blob !== 'undefined' && source instanceof Blob && source.type
      ? source.type
      : 'application/octet-stream');
  const partSize = Math.max(1, Math.floor(options.partSize ?? DEFAULT_PART_SIZE));
  const concurrency = Math.max(
    1,
    Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY),
  );
  const credentials: RequestCredentials = options.withCredentials
    ? 'include'
    : 'same-origin';
  const retryOpts: RetryOptions = { ...options.retry, signal };

  const initUrl = buildActionUrl(endpoint, { action: 'init' });
  const initText = await withRetry(
    () =>
      requestText(
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
            path: options.path,
            contentType,
            ...(options.bucket ? { bucket: options.bucket } : {}),
            ...(options.metadata ? { metadata: options.metadata } : {}),
          }),
        },
        signal,
      ),
    retryOpts,
  );

  const session = JSON.parse(initText) as StorageMultipartCreateResult;
  const totalParts = Math.max(1, Math.ceil(totalSize / partSize));
  const uploadedParts: StorageMultipartPartResult[] = [];
  let loadedBytes = 0;
  let completedParts = 0;
  let nextIndex = 0;
  let firstError: unknown = null;

  const abortSessionBestEffort = async (): Promise<void> => {
    const abortUrl = buildActionUrl(endpoint, {
      action: 'abort',
      uploadId: session.uploadId,
    });
    await fetchImpl(abortUrl, {
      method: 'DELETE',
      headers: { ...(options.headers ?? {}) },
      credentials,
    }).catch(() => {});
  };

  try {
    const workerCount = Math.min(concurrency, totalParts);
    const workers = Array.from({ length: workerCount }, async () => {
      while (!firstError) {
        if (signal?.aborted) {
          throw createCancelledUploadError();
        }
        const index = nextIndex++;
        if (index >= totalParts) return;

        const partNumber = index + 1;
        const start = index * partSize;
        const end = Math.min(totalSize, start + partSize);
        const bytes = await readSlice(source, start, end);
        const partUrl = buildActionUrl(endpoint, {
          action: 'part',
          uploadId: session.uploadId,
          partNumber: String(partNumber),
        });

        const partText = await withRetry(
          () =>
            requestText(
              fetchImpl,
              partUrl,
              {
                method: 'PUT',
                headers: {
                  'content-type': 'application/octet-stream',
                  ...(options.headers ?? {}),
                },
                credentials,
                body: bytes,
              },
              signal,
            ),
          retryOpts,
        );

        const partResult = JSON.parse(partText) as StorageMultipartPartResult;
        uploadedParts.push(partResult);
        loadedBytes += bytes.byteLength;
        completedParts++;
        options.onProgress?.({
          loaded: loadedBytes,
          total: totalSize,
          percent: totalSize > 0 ? Math.round((loadedBytes / totalSize) * 100) : 100,
          completedParts,
          totalParts,
        });
      }
    });

    await Promise.all(
      workers.map((w) =>
        w.catch((err: unknown) => {
          if (!firstError) firstError = err;
          throw err;
        }),
      ),
    );

    uploadedParts.sort((a, b) => a.partNumber - b.partNumber);
    const completeUrl = buildActionUrl(endpoint, { action: 'complete' });
    const completeText = await withRetry(
      () =>
        requestText(
          fetchImpl,
          completeUrl,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(options.headers ?? {}),
            },
            credentials,
            body: JSON.stringify({
              uploadId: session.uploadId,
              parts: uploadedParts,
            }),
          },
          signal,
        ),
      retryOpts,
    );

    return JSON.parse(completeText) as StorageUploadResult;
  } catch (err) {
    await abortSessionBestEffort();
    throw err;
  }
}
