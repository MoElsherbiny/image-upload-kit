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
