import { normalizeStorageError, sanitizeStorageKey } from './errorNormalizer';
import {
  readS3BodyToBytes, type S3ListedObject, type S3ListObjectsInput,
  type S3StorageAdapterOptions, type S3TransportLike,
} from './s3Types';
import {
  type StorageAdapter, type StorageDownloadOptions, type StorageFileEntry,
  type StorageHealthCheckResult, type StorageListOptions, type StorageMultipartAbortParams,
  type StorageMultipartCompleteParams, type StorageMultipartCreateParams,
  type StorageMultipartCreateResult, type StorageMultipartPartParams,
  type StorageMultipartPartResult, type StoragePaginatedListResult,
  type StoragePresignedDownloadOptions, type StoragePresignedDownloadResult,
  type StoragePresignParams, type StoragePresignResult, type StorageUploadParams,
  type StorageUploadResult, toPaginatedListResult, validateStorageMetadata,
} from './types';

export * from './s3Types';

function normalizeS3Key(rawPath: string): string {
  return sanitizeStorageKey(rawPath, 'S3');
}

function resolveTransport(options: S3StorageAdapterOptions): S3TransportLike {
  if ('client' in options && options.client) return options.client;
  if ('transport' in options && options.transport) return options.transport;
  if ('putObject' in options && typeof options.putObject === 'function') return options;
  throw new Error('S3StorageAdapter requires putObject/deleteObject or client/transport');
}

function isS3PreconditionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    code?: unknown;
    name?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  const status = e.$metadata?.httpStatusCode ?? Number(e.statusCode);
  const code = String(e.code ?? e.name ?? '').toLowerCase();
  return status === 412 || code === 'preconditionfailed' || code === 'eexist';
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
      validateStorageMetadata(params.metadata);
      const isImmutable = params.upsert === false && params.contentType.includes('image/avif');
      const cacheControl =
        params.cacheControl ??
        options.cacheControl ??
        (isImmutable
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=2592000, must-revalidate');
      const metadata =
        params.metadata || params.contentHash
          ? { ...params.metadata, ...(params.contentHash ? { contentHash: params.contentHash } : {}) }
          : undefined;

      try {
        await transport.putObject({
          Bucket: params.bucket,
          Key: key,
          Body: params.data,
          ContentType: params.contentType,
          ...(cacheControl ? { CacheControl: cacheControl } : {}),
          ...(metadata ? { Metadata: metadata } : {}),
          ...(params.upsert === false ? { IfNoneMatch: '*' } : {}),
        });
      } catch (err) {
        if (isS3PreconditionError(err)) {
          const existsErr = new Error(
            `Object already exists at ${params.bucket}/${key}`,
          ) as Error & { code?: string; statusCode?: number };
          existsErr.code = 'EEXIST';
          existsErr.statusCode = 412;
          throw existsErr;
        }
        throw err;
      }

      return { bucket: params.bucket, path: key, url: getPublicUrl(params.bucket, key) };
    },

    async delete(bucket: string, path: string): Promise<void> {
      await transport.deleteObject({ Bucket: bucket, Key: normalizeS3Key(path) });
    },

    async exists(bucket: string, path: string): Promise<boolean> {
      const key = normalizeS3Key(path);
      if (transport.headObject) {
        try {
          await transport.headObject({ Bucket: bucket, Key: key });
          return true;
        } catch {
          return false;
        }
      }
      const lastSlash = key.lastIndexOf('/');
      const folder = lastSlash > 0 ? key.slice(0, lastSlash) : undefined;
      const targetName = lastSlash > 0 ? key.slice(lastSlash + 1) : key;
      const listed = await this.list!(bucket, folder);
      return listed.some((item) => item.name === targetName);
    },

    async stat(bucket: string, path: string) {
      const key = normalizeS3Key(path);
      if (!transport.headObject) return null;
      try {
        const head = (await transport.headObject({ Bucket: bucket, Key: key })) as
          | { ContentLength?: number; ContentType?: string }
          | undefined;
        if (!head || typeof head.ContentLength !== 'number') return null;
        return {
          size: head.ContentLength,
          ...(typeof head.ContentType === 'string' ? { contentType: head.ContentType } : {}),
        };
      } catch {
        return null;
      }
    },

    getPublicUrl,

    async list(
      bucket: string,
      folder?: string,
      listOptions?: StorageListOptions,
    ): Promise<StoragePaginatedListResult> {
      const cleanFolder = folder ? normalizeS3Key(folder).replace(/\/+$/, '') : '';
      const prefix = cleanFolder ? `${cleanFolder}/` : undefined;
      const input: S3ListObjectsInput = {
        Bucket: bucket,
        ...(prefix ? { Prefix: prefix } : {}),
        MaxKeys: listOptions?.limit ?? 1000,
        ...(listOptions?.cursor ? { ContinuationToken: listOptions.cursor } : {}),
      };
      const output = transport.listObjects
        ? await transport.listObjects(input)
        : transport.listObjectsV2
          ? await transport.listObjectsV2(input)
          : undefined;

      const entries: StorageFileEntry[] = (output?.Contents ?? [])
        .filter((item): item is S3ListedObject & { Key: string } => Boolean(item.Key))
        .map((item) => {
          const name = prefix && item.Key.startsWith(prefix) ? item.Key.slice(prefix.length) : item.Key;
          const createdAt = item.LastModified instanceof Date ? item.LastModified.toISOString() : item.LastModified;
          return {
            name,
            id: `${bucket}/${item.Key}`,
            ...(createdAt !== undefined ? { createdAt } : {}),
            ...(item.Size !== undefined ? { size: item.Size } : {}),
          };
        })
        .filter((entry) => entry.name.length > 0);
      return toPaginatedListResult(entries, output?.NextContinuationToken);
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
          return { bucket: rest.slice(0, slashIdx), path: normalizeS3Key(rest.slice(slashIdx + 1)) };
        }
        if (!options.defaultBucket) return null;
        return { bucket: options.defaultBucket, path: normalizeS3Key(rest) };
      } catch {
        return null;
      }
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const parsed = this.parseUrl?.(url);
      if (!parsed || !parsed.bucket) return false;
      try {
        await transport.deleteObject({ Bucket: parsed.bucket, Key: parsed.path });
        return true;
      } catch {
        return false;
      }
    },

    async createPresignedUpload(params: StoragePresignParams): Promise<StoragePresignResult> {
      const key = normalizeS3Key(params.path);
      validateStorageMetadata(params.metadata);
      if (!options.presignUpload) throw new Error('S3StorageAdapter does not have presignUpload configured');
      return options.presignUpload({ ...params, path: key });
    },

    async createPresignedDownload(
      bucket: string,
      path: string,
      downloadOptions?: StoragePresignedDownloadOptions,
    ): Promise<StoragePresignedDownloadResult> {
      const key = normalizeS3Key(path);
      if (!options.presignDownload) throw new Error('S3StorageAdapter does not have presignDownload configured');
      return options.presignDownload(bucket, key, downloadOptions);
    },

    async download(bucket: string, path: string, downloadOptions?: StorageDownloadOptions): Promise<Uint8Array> {
      const key = normalizeS3Key(path);
      if (!transport.getObject) throw new Error('S3StorageAdapter transport does not implement getObject');
      const res = await transport.getObject({ Bucket: bucket, Key: key });
      return readS3BodyToBytes(res?.Body, bucket, key, downloadOptions?.maxBytes);
    },

    async healthCheck(): Promise<StorageHealthCheckResult> {
      const start = Date.now();
      const bucket = options.healthCheckBucket ?? options.defaultBucket ?? 'healthcheck';
      try {
        if (transport.listObjectsV2) await transport.listObjectsV2({ Bucket: bucket, MaxKeys: 1 });
        else if (transport.listObjects) await transport.listObjects({ Bucket: bucket, MaxKeys: 1 });
        else if (transport.headObject) {
          try {
            await transport.headObject({ Bucket: bucket, Key: '.iuk-healthcheck' });
          } catch (headErr) {
            if (normalizeStorageError(headErr, { provider: 's3', operation: 'healthCheck' }).status !== 404) {
              throw headErr;
            }
          }
        }
        return { ok: true, latencyMs: Date.now() - start };
      } catch (err) {
        const normalized = normalizeStorageError(err, { provider: 's3', operation: 'healthCheck' });
        return { ok: false, latencyMs: Date.now() - start, message: normalized.message };
      }
    },

    async createMultipartUpload(params: StorageMultipartCreateParams): Promise<StorageMultipartCreateResult> {
      const key = normalizeS3Key(params.path);
      validateStorageMetadata(params.metadata);
      if (!transport.createMultipartUpload) throw new Error('S3StorageAdapter transport does not implement createMultipartUpload');
      const res = await transport.createMultipartUpload({
        Bucket: params.bucket,
        Key: key,
        ContentType: params.contentType,
        ...(params.metadata ? { Metadata: params.metadata } : {}),
      });
      if (!res?.UploadId) throw new Error('S3 createMultipartUpload did not return an UploadId');
      return { uploadId: res.UploadId, bucket: params.bucket, path: key };
    },

    async uploadPart(params: StorageMultipartPartParams): Promise<StorageMultipartPartResult> {
      const key = normalizeS3Key(params.path);
      if (!transport.uploadPart) throw new Error('S3StorageAdapter transport does not implement uploadPart');
      const res = await transport.uploadPart({
        Bucket: params.bucket, Key: key, UploadId: params.uploadId, PartNumber: params.partNumber, Body: params.data,
      });
      if (!res?.ETag) throw new Error('S3 uploadPart did not return an ETag');
      return { partNumber: params.partNumber, etag: res.ETag };
    },

    async completeMultipartUpload(params: StorageMultipartCompleteParams): Promise<StorageUploadResult> {
      const key = normalizeS3Key(params.path);
      if (!transport.completeMultipartUpload) throw new Error('S3StorageAdapter transport does not implement completeMultipartUpload');
      await transport.completeMultipartUpload({
        Bucket: params.bucket,
        Key: key,
        UploadId: params.uploadId,
        MultipartUpload: { Parts: params.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      });
      return { bucket: params.bucket, path: key, url: getPublicUrl(params.bucket, key) };
    },

    async abortMultipartUpload(params: StorageMultipartAbortParams): Promise<void> {
      const key = normalizeS3Key(params.path);
      if (!transport.abortMultipartUpload) throw new Error('S3StorageAdapter transport does not implement abortMultipartUpload');
      await transport.abortMultipartUpload({ Bucket: params.bucket, Key: key, UploadId: params.uploadId });
    },
  };
}
