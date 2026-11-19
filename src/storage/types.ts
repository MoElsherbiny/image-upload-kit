import type { ImageUploadRecord } from '../types';

export interface StorageUploadParams {
  bucket: string;
  path: string;
  data: Buffer | Uint8Array;
  contentType: string;
  upsert?: boolean;
  cacheControl?: string;
  contentHash?: string;
  metadata?: Record<string, string>;
  /** Optional cancellation signal. Adapters may forward it to the transport or ignore it. */
  signal?: AbortSignal;
}

export interface StorageUploadResult {
  bucket: string;
  path: string;
  url: string;
}

export interface StoragePresignParams {
  bucket: string;
  path: string;
  contentType: string;
  maxBytes?: number;
  expiresInSeconds?: number;
  metadata?: Record<string, string>;
}

export interface StoragePresignResult {
  method: 'POST' | 'PUT';
  url: string;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  expiresAt?: string;
}

export interface StorageDownloadOptions {
  maxBytes?: number;
}

export interface StoragePresignedDownloadOptions {
  expiresInSeconds?: number;
}

export interface StoragePresignedDownloadResult {
  url: string;
  expiresAt?: string;
}

export interface StorageHealthCheckResult {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

export interface StorageMultipartCreateParams {
  bucket: string;
  path: string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface StorageMultipartCreateResult {
  uploadId: string;
  bucket: string;
  path: string;
}

export interface StorageMultipartPartParams {
  bucket: string;
  path: string;
  uploadId: string;
  partNumber: number;
  data: Buffer | Uint8Array;
}

export interface StorageMultipartPartResult {
  partNumber: number;
  etag: string;
}

export interface StorageMultipartCompleteParams {
  bucket: string;
  path: string;
  uploadId: string;
  parts: StorageMultipartPartResult[];
}

export interface StorageMultipartAbortParams {
  bucket: string;
  path: string;
  uploadId: string;
}

export interface StorageFileEntry {
  name: string;
  id?: string;
  createdAt?: string;
  size?: number;
}

export interface StorageListOptions {
  cursor?: string;
  limit?: number;
}

export type StoragePaginatedListResult = StorageFileEntry[] & {
  items: StorageFileEntry[];
  nextCursor?: string;
};

export type StorageUploadOptions = StorageUploadParams;
export type StorageFileMetadata = StorageFileEntry;
export type StorageListResult = StoragePaginatedListResult;

export interface StorageAdapter {
  /**
   * Upload optimized image bytes to your storage backend and return its public URL.
   */
  upload(params: StorageUploadParams): Promise<StorageUploadResult>;

  /**
   * Delete an image from your storage backend by bucket and relative path.
   */
  delete(bucket: string, path: string): Promise<void>;

  /**
   * Optional: Check whether an object exists at the given bucket and relative path.
   */
  exists?(bucket: string, path: string): Promise<boolean>;

  /**
   * Optional: Resolve a public URL for a bucket and path.
   */
  getPublicUrl?(bucket: string, path: string): string | Promise<string>;

  /**
   * Optional: List files inside a bucket/folder (supports optional cursor/limit pagination).
   */
  list?(
    bucket: string,
    folder?: string,
    options?: StorageListOptions,
  ): Promise<StoragePaginatedListResult>;

  /**
   * Optional: Delete an asset directly from its public URL.
   */
  deleteByUrl?(url: string): Promise<boolean>;

  /**
   * Optional: Parse a public storage URL into its bucket and relative path.
   */
  parseUrl?(url: string): { bucket?: string; path: string } | null;

  /**
   * Optional: Create a short-lived presigned upload target (`POST` or `PUT`) for direct-to-storage staging.
   */
  createPresignedUpload?(
    params: StoragePresignParams,
  ): Promise<StoragePresignResult>;

  /**
   * Optional: Retrieve object size and content-type metadata without downloading its body.
   */
  stat?(
    bucket: string,
    path: string,
  ): Promise<{ size: number; contentType?: string } | null>;

  /**
   * Optional: Download raw object bytes from the storage backend by bucket and relative path.
   */
  download?(
    bucket: string,
    path: string,
    options?: StorageDownloadOptions,
  ): Promise<Uint8Array>;

  /**
   * Optional: Generate a short-lived signed download URL for private objects.
   */
  createPresignedDownload?(
    bucket: string,
    path: string,
    options?: StoragePresignedDownloadOptions,
  ): Promise<StoragePresignedDownloadResult>;

  /**
   * Optional: Probe storage connectivity and measure round-trip latency.
   */
  healthCheck?(): Promise<StorageHealthCheckResult>;

  /** Optional: Initiate a multipart upload session. */
  createMultipartUpload?(
    params: StorageMultipartCreateParams,
  ): Promise<StorageMultipartCreateResult>;

  /** Optional: Upload an individual part within an active multipart session. */
  uploadPart?(
    params: StorageMultipartPartParams,
  ): Promise<StorageMultipartPartResult>;

  /** Optional: Finalize an active multipart upload and return the stored object. */
  completeMultipartUpload?(
    params: StorageMultipartCompleteParams,
  ): Promise<StorageUploadResult>;

  /** Optional: Abort an active multipart upload session and discard uploaded parts. */
  abortMultipartUpload?(params: StorageMultipartAbortParams): Promise<void>;
}

export type UploadRecordHook = (
  record: ImageUploadRecord,
) => void | Promise<void>;

/**
 * Attaches non-enumerable `.items` and `.nextCursor` properties to a `StorageFileEntry[]`
 * array so both array callers (`entries.map(...)`) and paginated destructuring callers
 * (`const { items, nextCursor } = await adapter.list(...)`) work seamlessly.
 */
export function toPaginatedListResult(
  entries: StorageFileEntry[],
  nextCursor?: string,
): StoragePaginatedListResult {
  const result = entries as StoragePaginatedListResult;
  Object.defineProperties(result, {
    items: {
      value: entries,
      enumerable: false,
      configurable: true,
    },
    nextCursor: {
      value: nextCursor,
      enumerable: false,
      configurable: true,
    },
  });
  return result;
}

const PRINTABLE_ASCII_REGEX = /^[\x20-\x7E]*$/;
const MAX_METADATA_BYTES = 2048;

/**
 * Validates that storage metadata keys and values contain only printable ASCII
 * characters (preventing HTTP header/CRLF injection) and do not exceed 2 KB total.
 */
export function validateStorageMetadata(
  metadata?: Record<string, string>,
): void {
  if (!metadata) return;
  let totalBytes = 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (
      !key ||
      typeof value !== 'string' ||
      !PRINTABLE_ASCII_REGEX.test(key) ||
      !PRINTABLE_ASCII_REGEX.test(value)
    ) {
      const err = new Error(
        'Invalid storage metadata: keys and values must contain printable ASCII characters only',
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }
    totalBytes += key.length + value.length;
    if (totalBytes > MAX_METADATA_BYTES) {
      const err = new Error(
        `Storage metadata exceeds maximum size of ${MAX_METADATA_BYTES} bytes`,
      ) as Error & { status?: number };
      err.status = 400;
      throw err;
    }
  }
}

/**
 * Type-safe helper for authoring a custom StorageAdapter (S3, R2, Vercel Blob, Firebase, etc.).
 */
export function createStorageAdapter(adapter: StorageAdapter): StorageAdapter {
  return adapter;
}
