import type { StoragePresignParams, StoragePresignResult } from './types';

export interface S3PutObjectInput {
  Bucket: string;
  Key: string;
  Body: Buffer | Uint8Array;
  ContentType: string;
  CacheControl?: string;
  Metadata?: Record<string, string>;
  IfNoneMatch?: string;
}

export interface S3DeleteObjectInput {
  Bucket: string;
  Key: string;
}

export interface S3HeadObjectInput {
  Bucket: string;
  Key: string;
}

export interface S3HeadObjectOutput {
  ContentLength?: number;
  ContentType?: string;
}

export interface S3GetObjectInput {
  Bucket: string;
  Key: string;
}

export interface S3GetObjectOutput {
  Body?: unknown;
}

export interface S3ListObjectsInput {
  Bucket: string;
  Prefix?: string;
  MaxKeys?: number;
  ContinuationToken?: string;
}

export interface S3ListedObject {
  Key?: string;
  Size?: number;
  LastModified?: Date | string;
}

export interface S3ListObjectsOutput {
  Contents?: S3ListedObject[];
  NextContinuationToken?: string;
  IsTruncated?: boolean;
}

/** Structural S3 / Cloudflare R2 / MinIO transport with zero runtime SDK dependency. */
export interface S3TransportLike {
  putObject(input: S3PutObjectInput): Promise<unknown>;
  deleteObject(input: S3DeleteObjectInput): Promise<unknown>;
  headObject?(input: S3HeadObjectInput): Promise<S3HeadObjectOutput | unknown>;
  getObject?(input: S3GetObjectInput): Promise<S3GetObjectOutput | { Body?: unknown }>;
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
  /** Optional delegate to generate a presigned upload URL (`PUT` or `POST`) for direct-to-S3 staging. */
  presignUpload?: (params: StoragePresignParams) => Promise<StoragePresignResult>;
}

export type S3StorageAdapterOptions = S3StorageBaseOptions &
  (
    | (S3TransportLike & { client?: never; transport?: never })
    | { client: S3TransportLike; transport?: never; putObject?: never }
    | { transport: S3TransportLike; client?: never; putObject?: never }
  );

function createMaxBytesError(): Error & { status?: number } {
  const err = new Error('Staged file size exceeds maximum allowed bytes') as Error & {
    status?: number;
  };
  err.status = 400;
  return err;
}

function enforceMaxBytes(bytes: Uint8Array, maxBytes?: number): Uint8Array {
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) throw createMaxBytesError();
  return bytes;
}

export async function readS3BodyToBytes(
  body: unknown,
  bucket: string,
  key: string,
  maxBytes?: number,
): Promise<Uint8Array> {
  if (body === undefined || body === null) {
    throw new Error(`Empty S3 object body for ${bucket}/${key}`);
  }
  if (body instanceof Uint8Array) {
    return enforceMaxBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), maxBytes);
  }
  if (body instanceof ArrayBuffer) {
    return enforceMaxBytes(new Uint8Array(body), maxBytes);
  }
  if (typeof body === 'string') {
    return enforceMaxBytes(new TextEncoder().encode(body), maxBytes);
  }
  const obj = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  };
  if (typeof obj[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of body as AsyncIterable<unknown>) {
      const bytes =
        chunk instanceof Uint8Array
          ? chunk
          : typeof chunk === 'string'
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk as ArrayBuffer);
      total += bytes.byteLength;
      if (maxBytes !== undefined && total > maxBytes) throw createMaxBytesError();
      chunks.push(bytes);
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      combined.set(c, offset);
      offset += c.byteLength;
    }
    return combined;
  }
  if (typeof obj.transformToByteArray === 'function') {
    return enforceMaxBytes(await obj.transformToByteArray(), maxBytes);
  }
  if (typeof obj.arrayBuffer === 'function') {
    return enforceMaxBytes(new Uint8Array(await obj.arrayBuffer()), maxBytes);
  }
  throw new Error(`Unsupported S3 object body type for ${bucket}/${key}`);
}
