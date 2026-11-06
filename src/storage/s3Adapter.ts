import type {
  StorageAdapter,
  StorageFileEntry,
  StorageUploadParams,
  StorageUploadResult,
} from './types';

export interface S3PutObjectInput {
  Bucket: string;
  Key: string;
  Body: Buffer | Uint8Array;
  ContentType: string;
  CacheControl?: string;
  Metadata?: Record<string, string>;
}

export interface S3DeleteObjectInput {
  Bucket: string;
  Key: string;
}

export interface S3ListObjectsInput {
  Bucket: string;
  Prefix?: string;
  MaxKeys?: number;
}

export interface S3ListedObject {
  Key?: string;
  Size?: number;
  LastModified?: Date | string;
}

export interface S3ListObjectsOutput {
  Contents?: S3ListedObject[];
}

/** Structural S3 / Cloudflare R2 / MinIO transport with zero runtime SDK dependency. */
export interface S3TransportLike {
  putObject(input: S3PutObjectInput): Promise<unknown>;
  deleteObject(input: S3DeleteObjectInput): Promise<unknown>;
  listObjects?(input: S3ListObjectsInput): Promise<S3ListObjectsOutput>;
  listObjectsV2?(input: S3ListObjectsInput): Promise<S3ListObjectsOutput>;
}

export type S3PublicUrlBuilder = (bucket: string, path: string) => string;

export interface S3StorageBaseOptions {
  /** Public base URL prefix (e.g. `'https://cdn.example.com'`) or `(bucket, path) => string` builder. */
  publicBaseUrl: string | S3PublicUrlBuilder;
  /** Default `Cache-Control` header applied when `StorageUploadParams.cacheControl` is omitted. */
  cacheControl?: string;
  /** Include `bucket` segment in string-prefix URLs (`${publicBaseUrl}/${bucket}/${path}`). Defaults to `true`. */
  includeBucketInUrl?: boolean;
  /** Fallback bucket used by `deleteByUrl` when `includeBucketInUrl` is `false`. */
  defaultBucket?: string;
}

export type S3StorageAdapterOptions = S3StorageBaseOptions &
  (
    | (S3TransportLike & { client?: never; transport?: never })
    | { client: S3TransportLike; transport?: never; putObject?: never }
    | { transport: S3TransportLike; client?: never; putObject?: never }
  );

function normalizeS3Key(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) throw new Error('Invalid S3 object key');
  return normalized;
}

function resolveTransport(options: S3StorageAdapterOptions): S3TransportLike {
  if ('client' in options && options.client) return options.client;
  if ('transport' in options && options.transport) return options.transport;
  if ('putObject' in options && typeof options.putObject === 'function') return options;
  throw new Error('S3StorageAdapter requires putObject/deleteObject or client/transport');
}

/** Zero-dependency S3 / Cloudflare R2 / MinIO `StorageAdapter`. */
export function createS3StorageAdapter(options: S3StorageAdapterOptions): StorageAdapter {
  const transport = resolveTransport(options);
  const includeBucket = options.includeBucketInUrl !== false;

  const getPublicUrl = (bucket: string, path: string): string => {
    const key = normalizeS3Key(path);
    if (typeof options.publicBaseUrl === 'function') return options.publicBaseUrl(bucket, key);
    const base = options.publicBaseUrl.replace(/\/+$/, '');
    return includeBucket ? `${base}/${bucket}/${key}` : `${base}/${key}`;
  };

  return {
    async upload(params: StorageUploadParams): Promise<StorageUploadResult> {
      const key = normalizeS3Key(params.path);
      const cacheControl =
        params.cacheControl ??
        options.cacheControl ??
        (params.contentType.includes('image/avif')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=2592000, must-revalidate');

      const metadata =
        params.metadata || params.contentHash
          ? {
              ...(params.contentHash ? { contentHash: params.contentHash } : {}),
              ...params.metadata,
            }
          : undefined;

      await transport.putObject({
        Bucket: params.bucket,
        Key: key,
        Body: params.data,
        ContentType: params.contentType,
        ...(cacheControl ? { CacheControl: cacheControl } : {}),
        ...(metadata ? { Metadata: metadata } : {}),
      });

      return {
        bucket: params.bucket,
        path: key,
        url: getPublicUrl(params.bucket, key),
      };
    },

    async delete(bucket: string, path: string): Promise<void> {
      await transport.deleteObject({ Bucket: bucket, Key: normalizeS3Key(path) });
    },

    getPublicUrl,

    async list(bucket: string, folder?: string): Promise<StorageFileEntry[]> {
      const cleanFolder = folder ? normalizeS3Key(folder).replace(/\/+$/, '') : '';
      const prefix = cleanFolder ? `${cleanFolder}/` : undefined;
      const input: S3ListObjectsInput = {
        Bucket: bucket,
        ...(prefix ? { Prefix: prefix } : {}),
        MaxKeys: 1000,
      };

      const output = transport.listObjects
        ? await transport.listObjects(input)
        : transport.listObjectsV2
          ? await transport.listObjectsV2(input)
          : undefined;

      return (output?.Contents ?? [])
        .filter((item): item is S3ListedObject & { Key: string } => Boolean(item.Key))
        .map((item) => {
          const name =
            prefix && item.Key.startsWith(prefix)
              ? item.Key.slice(prefix.length)
              : item.Key;
          const createdAt =
            item.LastModified instanceof Date
              ? item.LastModified.toISOString()
              : item.LastModified;
          return {
            name,
            id: `${bucket}/${item.Key}`,
            ...(createdAt !== undefined ? { createdAt } : {}),
            ...(item.Size !== undefined ? { size: item.Size } : {}),
          };
        })
        .filter((entry) => entry.name.length > 0);
    },

    parseUrl(url: string): { bucket?: string; path: string } | null {
      if (typeof options.publicBaseUrl !== 'string' || !url) return null;
      const prefix = `${options.publicBaseUrl.replace(/\/+$/, '')}/`;
      const cleanUrl = url.split(/[?#]/)[0];
      if (!cleanUrl.startsWith(prefix)) return null;

      try {
        const rest = decodeURIComponent(cleanUrl.slice(prefix.length)).replace(/^\/+/, '');
        if (!rest) return null;

        if (includeBucket) {
          const slashIdx = rest.indexOf('/');
          if (slashIdx <= 0 || slashIdx === rest.length - 1) return null;
          return {
            bucket: rest.slice(0, slashIdx),
            path: rest.slice(slashIdx + 1),
          };
        }

        if (!options.defaultBucket) return null;
        return { bucket: options.defaultBucket, path: rest };
      } catch {
        return null;
      }
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const parsed = this.parseUrl?.(url);
      if (!parsed || !parsed.bucket) return false;

      try {
        await transport.deleteObject({
          Bucket: parsed.bucket,
          Key: parsed.path,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
