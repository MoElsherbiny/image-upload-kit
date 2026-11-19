import { isUploadKitError, UploadKitError } from '../types/errors';
import { normalizeStorageError, sanitizeStorageKey, toStorageFailure } from './errorNormalizer';
import {
  type StorageAdapter, type StorageDownloadOptions, type StorageHealthCheckResult,
  type StorageListOptions, type StoragePaginatedListResult, type StoragePresignedDownloadOptions,
  type StoragePresignedDownloadResult, type StoragePresignParams, type StoragePresignResult,
  type StorageUploadParams, type StorageUploadResult, toPaginatedListResult, validateStorageMetadata,
} from './types';
import { DEFAULT_PUBLIC_STORAGE_PREFIX, parsePublicStorageUrl } from './urlParser';

/** Minimal structural interface matching `@supabase/supabase-js` Storage client. */
export interface SupabaseBucketClientLike {
  upload(
    path: string,
    fileBody: Buffer | Uint8Array,
    fileOptions?: { contentType?: string; upsert?: boolean; cacheControl?: string; metadata?: Record<string, string> },
  ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ data?: unknown; error: { message: string } | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  list?(
    path?: string,
    options?: { limit?: number; offset?: number; sortBy?: { column: string; order: string } },
  ): Promise<{ data: Array<{ name: string; id: string | null; created_at: string | null }> | null; error: { message: string } | null }>;
  createSignedUploadUrl?(path: string): Promise<{ data: { signedUrl: string; token?: string; path?: string } | null; error: { message: string } | null }>;
  createSignedUrl?(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
  download?(path: string): Promise<{ data: Blob | Uint8Array | ArrayBuffer | null; error: { message: string } | null }>;
}

export interface SupabaseStorageClientLike {
  storage: { from(bucket: string): SupabaseBucketClientLike };
}

export interface SupabaseStorageAdapterOptions {
  publicUrlPrefix?: string;
  healthCheckBucket?: string;
}

function normalizeSupabasePath(rawPath: string): string {
  return sanitizeStorageKey(rawPath, 'Supabase');
}

/**
 * Plug in any `@supabase/supabase-js` client instance (e.g., service-role client)
 * as a `StorageAdapter` with zero extra wrapper boilerplate.
 */
export function createSupabaseStorageAdapter(
  client: SupabaseStorageClientLike,
  options: SupabaseStorageAdapterOptions = {},
): StorageAdapter {
  const publicPrefix = options.publicUrlPrefix || DEFAULT_PUBLIC_STORAGE_PREFIX;

  return {
    async upload(params: StorageUploadParams): Promise<StorageUploadResult> {
      const cleanPath = normalizeSupabasePath(params.path);
      validateStorageMetadata(params.metadata);
      const isImmutable = params.upsert === false && params.contentType.includes('image/avif');
      const cacheControl =
        params.cacheControl ||
        (isImmutable
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=2592000, must-revalidate');

      let data: { path: string } | null;
      let error: { message: string; statusCode?: string | number } | null;
      try {
        ({ data, error } = await client.storage.from(params.bucket).upload(cleanPath, params.data, {
          contentType: params.contentType,
          upsert: params.upsert === undefined ? true : params.upsert,
          cacheControl,
          metadata: {
            ...params.metadata,
            uploadedAt: new Date().toISOString(),
            contentHash: params.contentHash || 'unknown',
          },
        }));
      } catch (err) {
        throw toStorageFailure(err, { provider: 'supabase', operation: 'upload' });
      }

      if (error || !data) {
        if (
          params.upsert === false &&
          error &&
          (String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message))
        ) {
          const existsErr = new Error(`Object already exists at ${params.bucket}/${cleanPath}`) as Error & { code?: string };
          existsErr.code = 'EEXIST';
          throw existsErr;
        }
        throw normalizeStorageError(error ?? new Error('Upload failed'), { provider: 'supabase', operation: 'upload' });
      }

      const { data: { publicUrl } } = client.storage.from(params.bucket).getPublicUrl(data.path);
      return { bucket: params.bucket, path: data.path, url: publicUrl };
    },

    async delete(bucket: string, path: string): Promise<void> {
      const cleanPath = normalizeSupabasePath(path);
      let res: { error: { message: string } | null };
      try {
        res = await client.storage.from(bucket).remove([cleanPath]);
      } catch (err) {
        throw toStorageFailure(err, { provider: 'supabase', operation: 'delete' });
      }
      if (res.error) {
        throw normalizeStorageError(res.error, { provider: 'supabase', operation: 'delete' });
      }
    },

    async exists(bucket: string, path: string): Promise<boolean> {
      const cleanPath = normalizeSupabasePath(path);
      const lastSlash = cleanPath.lastIndexOf('/');
      const folder = lastSlash > 0 ? cleanPath.slice(0, lastSlash) : undefined;
      const targetName = lastSlash > 0 ? cleanPath.slice(lastSlash + 1) : cleanPath;
      const entries = await this.list!(bucket, folder);
      return entries.some((entry) => entry.name === targetName);
    },

    getPublicUrl(bucket: string, path: string): string {
      const cleanPath = normalizeSupabasePath(path);
      const { data: { publicUrl } } = client.storage.from(bucket).getPublicUrl(cleanPath);
      return publicUrl;
    },

    async list(
      bucket: string,
      folder?: string,
      listOptions?: StorageListOptions,
    ): Promise<StoragePaginatedListResult> {
      const cleanFolder = folder ? normalizeSupabasePath(folder) : undefined;
      const bucketClient = client.storage.from(bucket);
      if (!bucketClient.list) return toPaginatedListResult([]);

      const limit = listOptions?.limit ?? 1000;
      const offset = listOptions?.cursor ? Number(listOptions.cursor) || 0 : 0;

      const { data, error } = await bucketClient.list(cleanFolder, {
        limit,
        ...(offset > 0 ? { offset } : {}),
        sortBy: { column: 'created_at', order: 'desc' },
      });

      if (error) {
        throw new Error(`Failed to list Supabase bucket files: ${error.message}`);
      }

      const entries = (data || [])
        .filter((f) => f.id !== null)
        .map((f) => ({
          name: f.name,
          id: f.id ?? undefined,
          createdAt: f.created_at ?? undefined,
        }));

      const nextCursor =
        listOptions?.limit !== undefined && entries.length >= limit
          ? String(offset + entries.length)
          : undefined;
      return toPaginatedListResult(entries, nextCursor);
    },

    parseUrl(url: string): { bucket?: string; path: string } | null {
      const info = parsePublicStorageUrl(url, publicPrefix);
      if (!info) return null;
      try {
        return { bucket: info.bucket, path: normalizeSupabasePath(info.path) };
      } catch {
        return null;
      }
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const parsed = this.parseUrl?.(url);
      if (!parsed?.bucket) return false;
      try {
        const { error } = await client.storage.from(parsed.bucket).remove([parsed.path]);
        if (!error) return true;
        const norm = normalizeStorageError(error, { provider: 'supabase', operation: 'delete' });
        if (norm.status === 404) return false;
        throw norm;
      } catch (err) {
        const failure = toStorageFailure(err, { provider: 'supabase', operation: 'delete' });
        if (isUploadKitError(failure) && failure.status === 404) return false;
        throw failure;
      }
    },

    async createPresignedUpload(params: StoragePresignParams): Promise<StoragePresignResult> {
      validateStorageMetadata(params.metadata);
      const cleanPath = normalizeSupabasePath(params.path);
      const bucketClient = client.storage.from(params.bucket);
      if (!bucketClient.createSignedUploadUrl) {
        throw new Error('Supabase storage client does not support createSignedUploadUrl');
      }
      const { data, error } = await bucketClient.createSignedUploadUrl(cleanPath);
      if (error || !data?.signedUrl) {
        throw new Error(
          `Failed to create Supabase signed upload URL: ${error?.message || 'Unknown error'}`,
        );
      }
      return {
        method: 'PUT',
        url: data.signedUrl,
        headers: { 'content-type': params.contentType },
      };
    },

    async createPresignedDownload(
      bucket: string,
      path: string,
      downloadOptions?: StoragePresignedDownloadOptions,
    ): Promise<StoragePresignedDownloadResult> {
      const cleanPath = normalizeSupabasePath(path);
      const bucketClient = client.storage.from(bucket);
      if (!bucketClient.createSignedUrl) {
        throw new Error('Supabase storage client does not support createSignedUrl');
      }
      const expiresIn = downloadOptions?.expiresInSeconds ?? 300;
      const { data, error } = await bucketClient.createSignedUrl(cleanPath, expiresIn);
      if (error || !data?.signedUrl) {
        throw new Error(
          `Failed to create Supabase signed download URL: ${error?.message || 'Unknown error'}`,
        );
      }
      return {
        url: data.signedUrl,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      };
    },

    async download(
      bucket: string,
      path: string,
      downloadOptions?: StorageDownloadOptions,
    ): Promise<Uint8Array> {
      const cleanPath = normalizeSupabasePath(path);
      const bucketClient = client.storage.from(bucket);
      if (!bucketClient.download) {
        throw new Error('Supabase storage client does not support download');
      }
      let res: { data: Blob | Uint8Array | ArrayBuffer | null; error: { message: string } | null };
      try {
        res = await bucketClient.download(cleanPath);
      } catch (err) {
        throw toStorageFailure(err, { provider: 'supabase', operation: 'download' });
      }
      if (res.error || !res.data) {
        throw normalizeStorageError(
          res.error ?? Object.assign(new Error('Not found'), { status: 404, code: 'ENOENT' }),
          { provider: 'supabase', operation: 'download' },
        );
      }
      const { data } = res;
      let bytes: Uint8Array;
      if (data instanceof Uint8Array) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (typeof (data as Blob).arrayBuffer === 'function') {
        bytes = new Uint8Array(await (data as Blob).arrayBuffer());
      } else {
        throw normalizeStorageError(new Error('Unsupported download payload'), { provider: 'supabase', operation: 'download' });
      }
      if (downloadOptions?.maxBytes !== undefined && bytes.byteLength > downloadOptions.maxBytes) {
        throw new UploadKitError('Staged file size exceeds maximum allowed bytes', {
          code: 'FILE_TOO_LARGE', status: 400, retryable: false,
        });
      }
      return bytes;
    },

    async healthCheck(): Promise<StorageHealthCheckResult> {
      const start = Date.now();
      const bucketClient = client.storage.from(options.healthCheckBucket ?? 'healthcheck');
      try {
        if (bucketClient.list) {
          const { error } = await bucketClient.list(undefined, { limit: 1 });
          if (error) {
            const normalized = normalizeStorageError(error, { provider: 'supabase', operation: 'healthCheck' });
            return { ok: false, latencyMs: Date.now() - start, message: normalized.message };
          }
        }
        return { ok: true, latencyMs: Date.now() - start };
      } catch (err) {
        const normalized = normalizeStorageError(err, { provider: 'supabase', operation: 'healthCheck' });
        return { ok: false, latencyMs: Date.now() - start, message: normalized.message };
      }
    },
  };
}
