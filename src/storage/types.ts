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

export interface StorageFileEntry {
  name: string;
  id?: string;
  createdAt?: string;
  size?: number;
}

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
   * Optional: Resolve a public URL for a bucket and path.
   */
  getPublicUrl?(bucket: string, path: string): string | Promise<string>;

  /**
   * Optional: List files inside a bucket/folder.
   */
  list?(bucket: string, folder?: string): Promise<StorageFileEntry[]>;

  /**
   * Optional: Delete an asset directly from its public URL.
   */
  deleteByUrl?(url: string): Promise<boolean>;
}

export type UploadRecordHook = (
  record: ImageUploadRecord,
) => void | Promise<void>;

/**
 * Type-safe helper for authoring a custom StorageAdapter (S3, R2, Vercel Blob, Firebase, etc.).
 */
export function createStorageAdapter(adapter: StorageAdapter): StorageAdapter {
  return adapter;
}
