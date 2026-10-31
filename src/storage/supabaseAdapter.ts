import type {
  StorageAdapter,
  StorageFileEntry,
  StorageUploadParams,
  StorageUploadResult,
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
      const cacheControl =
        params.cacheControl ||
        (params.contentType.includes('image/avif')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=2592000, must-revalidate');

      const { data, error } = await client.storage
        .from(params.bucket)
        .upload(params.path, params.data, {
          contentType: params.contentType,
          upsert: params.upsert === undefined ? true : params.upsert,
          cacheControl,
          metadata: {
            uploadedAt: new Date().toISOString(),
            contentHash: params.contentHash || 'unknown',
            ...params.metadata,
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

    getPublicUrl(bucket: string, path: string): string {
      const {
        data: { publicUrl },
      } = client.storage.from(bucket).getPublicUrl(path);
      return publicUrl;
    },

    async list(bucket: string, folder?: string): Promise<StorageFileEntry[]> {
      const bucketClient = client.storage.from(bucket);
      if (!bucketClient.list) {
        return [];
      }

      const { data, error } = await bucketClient.list(folder, {
        limit: 1000,
        sortBy: { column: 'created_at', order: 'desc' },
      });

      if (error) {
        throw new Error(`Failed to list Supabase bucket files: ${error.message}`);
      }

      return (data || [])
        .filter((f) => f.id !== null)
        .map((f) => ({
          name: f.name,
          id: f.id ?? undefined,
          createdAt: f.created_at ?? undefined,
        }));
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const info = parsePublicStorageUrl(url, publicPrefix);
      if (!info) return false;

      try {
        const targets = new Set<string>([info.path]);
        if (info.extension?.toLowerCase() === '.avif') {
          const basePath = info.path.slice(0, -info.extension.length);
          targets.add(`${basePath}-blur${info.extension}`);
          targets.add(`${basePath}-thumb${info.extension}`);
        }
        const { error } = await client.storage
          .from(info.bucket)
          .remove([...targets]);
        return !error;
      } catch {
        return false;
      }
    },
  };
}
