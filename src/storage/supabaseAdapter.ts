import {
  type StorageAdapter,
  type StorageListOptions,
  type StoragePaginatedListResult,
  type StorageUploadParams,
  type StorageUploadResult,
  toPaginatedListResult,
  validateStorageMetadata,
} from './types';
import {
  DEFAULT_PUBLIC_STORAGE_PREFIX,
  parsePublicStorageUrl,
} from './urlParser';

/**
 * Minimal structural interface matching `@supabase/supabase-js` Storage client,
 * avoiding a mandatory `@supabase/supabase-js` runtime dependency.
 */
export interface SupabaseBucketClientLike {
  upload(
    path: string,
    fileBody: Buffer | Uint8Array,
    fileOptions?: {
      contentType?: string;
      upsert?: boolean;
      cacheControl?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<{
    data: { path: string } | null;
    error: { message: string } | null;
  }>;
  remove(paths: string[]): Promise<{
    data?: unknown;
    error: { message: string } | null;
  }>;
  getPublicUrl(path: string): {
    data: { publicUrl: string };
  };
  list?(
    path?: string,
    options?: {
      limit?: number;
      offset?: number;
      sortBy?: { column: string; order: string };
    },
  ): Promise<{
    data: Array<{
      name: string;
      id: string | null;
      created_at: string | null;
    }> | null;
    error: { message: string } | null;
  }>;
}

export interface SupabaseStorageClientLike {
  storage: {
    from(bucket: string): SupabaseBucketClientLike;
  };
}

export interface SupabaseStorageAdapterOptions {
  publicUrlPrefix?: string;
}

/**
 * Plug in any `@supabase/supabase-js` client instance (e.g., service-role client)
 * as a `StorageAdapter` with zero extra wrapper boilerplate.
 */
export function createSupabaseStorageAdapter(
  client: SupabaseStorageClientLike,
  options: SupabaseStorageAdapterOptions = {},
): StorageAdapter {
  const publicPrefix =
    options.publicUrlPrefix || DEFAULT_PUBLIC_STORAGE_PREFIX;

  return {
    async upload(params: StorageUploadParams): Promise<StorageUploadResult> {
      validateStorageMetadata(params.metadata);

      const isImmutable =
        params.upsert === false && params.contentType.includes('image/avif');
      const cacheControl =
        params.cacheControl ||
        (isImmutable
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=2592000, must-revalidate');

      const { data, error } = await client.storage
        .from(params.bucket)
        .upload(params.path, params.data, {
          contentType: params.contentType,
          upsert: params.upsert === undefined ? true : params.upsert,
          cacheControl,
          metadata: {
            ...params.metadata,
            uploadedAt: new Date().toISOString(),
            contentHash: params.contentHash || 'unknown',
          },
        });

      if (error || !data) {
        throw new Error(
          `Failed to upload to Supabase storage (bucket: ${params.bucket}, path: ${params.path}): ${error?.message || 'Unknown error'}`,
        );
      }

      const {
        data: { publicUrl },
      } = client.storage.from(params.bucket).getPublicUrl(data.path);

      return {
        bucket: params.bucket,
        path: data.path,
        url: publicUrl,
      };
    },

    async delete(bucket: string, path: string): Promise<void> {
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) {
        throw new Error(`Failed to delete from Supabase storage: ${error.message}`);
      }
    },

    async exists(bucket: string, path: string): Promise<boolean> {
      const cleanPath = path.replace(/^\/+/, '');
      const lastSlash = cleanPath.lastIndexOf('/');
      const folder = lastSlash > 0 ? cleanPath.slice(0, lastSlash) : undefined;
      const targetName = lastSlash > 0 ? cleanPath.slice(lastSlash + 1) : cleanPath;
      const entries = await this.list!(bucket, folder);
      return entries.some((entry) => entry.name === targetName);
    },

    getPublicUrl(bucket: string, path: string): string {
      const {
        data: { publicUrl },
      } = client.storage.from(bucket).getPublicUrl(path);
      return publicUrl;
    },

    async list(
      bucket: string,
      folder?: string,
      listOptions?: StorageListOptions,
    ): Promise<StoragePaginatedListResult> {
      const bucketClient = client.storage.from(bucket);
      if (!bucketClient.list) {
        return toPaginatedListResult([]);
      }

      const limit = listOptions?.limit ?? 1000;
      const offset = listOptions?.cursor ? Number(listOptions.cursor) || 0 : 0;

      const { data, error } = await bucketClient.list(folder, {
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
      return { bucket: info.bucket, path: info.path };
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const info = parsePublicStorageUrl(url, publicPrefix);
      if (!info) return false;

      try {
        const { error } = await client.storage
          .from(info.bucket)
          .remove([info.path]);
        return !error;
      } catch {
        return false;
      }
    },
  };
}
