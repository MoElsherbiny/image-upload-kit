import {
  type StorageAdapter,
  type StorageDownloadOptions,
  type StorageFileEntry,
  type StorageHealthCheckResult,
  type StorageListOptions,
  type StorageMultipartAbortParams,
  type StorageMultipartCompleteParams,
  type StorageMultipartCreateParams,
  type StorageMultipartCreateResult,
  type StorageMultipartPartParams,
  type StorageMultipartPartResult,
  type StoragePaginatedListResult,
  type StoragePresignedDownloadOptions,
  type StoragePresignedDownloadResult,
  type StoragePresignParams,
  type StoragePresignResult,
  type StorageUploadParams,
  type StorageUploadResult,
  toPaginatedListResult,
  validateStorageMetadata,
} from './types';

export interface StoredMemoryObject {
  bucket: string;
  path: string;
  data: Uint8Array;
  contentType: string;
  createdAt: string;
  metadata?: Record<string, string>;
}

interface MultipartSession {
  bucket: string;
  path: string;
  contentType: string;
  metadata?: Record<string, string>;
  parts: Map<number, { etag: string; data: Uint8Array }>;
}

export interface MemoryStorageAdapter extends StorageAdapter {
  exists(bucket: string, path: string): Promise<boolean>;
  stat(bucket: string, path: string): Promise<{ size: number; contentType?: string } | null>;
  getPublicUrl(bucket: string, path: string): string;
  list(bucket: string, folder?: string, options?: StorageListOptions): Promise<StoragePaginatedListResult>;
  deleteByUrl(url: string): Promise<boolean>;
  parseUrl(url: string): { bucket?: string; path: string } | null;
  createPresignedUpload(params: StoragePresignParams): Promise<StoragePresignResult>;
  createPresignedDownload(
    bucket: string,
    path: string,
    options?: StoragePresignedDownloadOptions,
  ): Promise<StoragePresignedDownloadResult>;
  download(bucket: string, path: string, options?: StorageDownloadOptions): Promise<Uint8Array>;
  healthCheck(): Promise<StorageHealthCheckResult>;
  createMultipartUpload(params: StorageMultipartCreateParams): Promise<StorageMultipartCreateResult>;
  uploadPart(params: StorageMultipartPartParams): Promise<StorageMultipartPartResult>;
  completeMultipartUpload(params: StorageMultipartCompleteParams): Promise<StorageUploadResult>;
  abortMultipartUpload(params: StorageMultipartAbortParams): Promise<void>;
  putPresigned(bucket: string, path: string, data: Buffer | Uint8Array, contentType?: string): Promise<void>;
  getObject(bucket: string, path: string): StoredMemoryObject | undefined;
  clear(): void;
  readonly size: number;
}

export interface MemoryStorageOptions {
  baseUrl?: string;
}

export function createMemoryStorageAdapter(options: MemoryStorageOptions = {}): MemoryStorageAdapter {
  const baseUrl = (options.baseUrl || 'https://memory.local/uploads').replace(/\/+$/, '');
  const store = new Map<string, StoredMemoryObject>();
  const multipartSessions = new Map<string, MultipartSession>();
  let uploadSeq = 0;

  const toKey = (bucket: string, path: string) => `${bucket}::${path.replace(/^\/+/, '')}`;
  const getPublicUrl = (bucket: string, path: string): string =>
    `${baseUrl}/${bucket}/${path.replace(/^\/+/, '')}`;

  return {
    async upload(params: StorageUploadParams): Promise<StorageUploadResult> {
      validateStorageMetadata(params.metadata);
      const cleanPath = params.path.replace(/^\/+/, '');
      const key = toKey(params.bucket, cleanPath);

      if (params.upsert === false && store.has(key)) {
        const existsErr = new Error(
          `Object already exists at ${params.bucket}/${cleanPath}`,
        ) as Error & { code?: string };
        existsErr.code = 'EEXIST';
        throw existsErr;
      }

      store.set(key, {
        bucket: params.bucket,
        path: cleanPath,
        data: new Uint8Array(params.data),
        contentType: params.contentType,
        createdAt: new Date().toISOString(),
        metadata: params.metadata,
      });

      return { bucket: params.bucket, path: cleanPath, url: getPublicUrl(params.bucket, cleanPath) };
    },

    async delete(bucket: string, path: string): Promise<void> {
      store.delete(toKey(bucket, path));
    },

    async exists(bucket: string, path: string): Promise<boolean> {
      return store.has(toKey(bucket, path));
    },

    async stat(bucket: string, path: string) {
      const obj = store.get(toKey(bucket, path.replace(/^\/+/, '')));
      return obj ? { size: obj.data.byteLength, contentType: obj.contentType } : null;
    },

    getPublicUrl,

    async list(
      bucket: string,
      folder?: string,
      listOptions?: StorageListOptions,
    ): Promise<StoragePaginatedListResult> {
      const cleanFolder = folder ? folder.replace(/^\/+|\/+$/g, '') : '';
      const entries: StorageFileEntry[] = [];
      for (const obj of store.values()) {
        if (obj.bucket !== bucket) continue;
        if (cleanFolder && !obj.path.startsWith(`${cleanFolder}/`)) continue;
        const name = cleanFolder ? obj.path.slice(cleanFolder.length + 1) : obj.path;
        entries.push({ name, id: `${obj.bucket}/${obj.path}`, createdAt: obj.createdAt, size: obj.data.byteLength });
      }
      const offset = listOptions?.cursor ? Number(listOptions.cursor) || 0 : 0;
      const limit = listOptions?.limit ?? entries.length;
      const sliced =
        listOptions?.limit !== undefined || offset > 0 ? entries.slice(offset, offset + limit) : entries;
      const nextCursor =
        listOptions?.limit !== undefined && offset + sliced.length < entries.length
          ? String(offset + sliced.length)
          : undefined;
      return toPaginatedListResult(sliced, nextCursor);
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const parsed = this.parseUrl?.(url);
      if (!parsed?.bucket) return false;
      return store.delete(toKey(parsed.bucket, parsed.path));
    },

    parseUrl(url: string): { bucket?: string; path: string } | null {
      const prefix = `${baseUrl}/`;
      if (!url || !url.startsWith(prefix)) return null;
      try {
        const cleanUrl = url.split(/[?#]/)[0];
        const rest = decodeURIComponent(cleanUrl.slice(prefix.length));
        const slashIdx = rest.indexOf('/');
        if (slashIdx <= 0 || slashIdx === rest.length - 1) return null;
        return { bucket: rest.slice(0, slashIdx), path: rest.slice(slashIdx + 1) };
      } catch {
        return null;
      }
    },

    async createPresignedUpload(params: StoragePresignParams): Promise<StoragePresignResult> {
      validateStorageMetadata(params.metadata);
      const cleanPath = params.path.replace(/^\/+/, '');
      const expiresAt = new Date(Date.now() + (params.expiresInSeconds ?? 300) * 1000).toISOString();
      return {
        method: 'PUT',
        url: `memory://presigned/${params.bucket}/${cleanPath}`,
        headers: { 'content-type': params.contentType },
        expiresAt,
      };
    },

    async createPresignedDownload(
      bucket: string,
      path: string,
      downloadOptions?: StoragePresignedDownloadOptions,
    ): Promise<StoragePresignedDownloadResult> {
      const cleanPath = path.replace(/^\/+/, '');
      const expiresAt = new Date(Date.now() + (downloadOptions?.expiresInSeconds ?? 300) * 1000).toISOString();
      return { url: `memory://signed-download/${bucket}/${cleanPath}`, expiresAt };
    },

    async download(bucket: string, path: string, downloadOptions?: StorageDownloadOptions): Promise<Uint8Array> {
      const cleanPath = path.replace(/^\/+/, '');
      const obj = store.get(toKey(bucket, cleanPath));
      if (!obj) {
        const err = new Error(`Object not found at ${bucket}/${cleanPath}`) as Error & { status?: number; code?: string };
        err.status = 404;
        err.code = 'ENOENT';
        throw err;
      }
      if (downloadOptions?.maxBytes !== undefined && obj.data.byteLength > downloadOptions.maxBytes) {
        const err = new Error('Staged file size exceeds maximum allowed bytes') as Error & { status?: number };
        err.status = 400;
        throw err;
      }
      return new Uint8Array(obj.data);
    },

    async healthCheck(): Promise<StorageHealthCheckResult> {
      return { ok: true, latencyMs: 0 };
    },

    async createMultipartUpload(params: StorageMultipartCreateParams): Promise<StorageMultipartCreateResult> {
      validateStorageMetadata(params.metadata);
      const cleanPath = params.path.replace(/^\/+/, '');
      const uploadId = `mem-mp-${++uploadSeq}`;
      multipartSessions.set(uploadId, {
        bucket: params.bucket,
        path: cleanPath,
        contentType: params.contentType,
        metadata: params.metadata,
        parts: new Map(),
      });
      return { uploadId, bucket: params.bucket, path: cleanPath };
    },

    async uploadPart(params: StorageMultipartPartParams): Promise<StorageMultipartPartResult> {
      const session = multipartSessions.get(params.uploadId);
      if (!session) throw new Error(`Unknown multipart uploadId: ${params.uploadId}`);
      if (!Number.isInteger(params.partNumber) || params.partNumber < 1) {
        throw new Error('Multipart partNumber must be a positive integer');
      }
      const bytes = new Uint8Array(params.data);
      const etag = `"part-${params.partNumber}-${bytes.byteLength}"`;
      session.parts.set(params.partNumber, { etag, data: bytes });
      return { partNumber: params.partNumber, etag };
    },

    async completeMultipartUpload(params: StorageMultipartCompleteParams): Promise<StorageUploadResult> {
      const session = multipartSessions.get(params.uploadId);
      if (!session) throw new Error(`Unknown multipart uploadId: ${params.uploadId}`);
      const sorted = [...params.parts].sort((a, b) => a.partNumber - b.partNumber);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (const reqPart of sorted) {
        const stored = session.parts.get(reqPart.partNumber);
        if (!stored || stored.etag !== reqPart.etag) {
          throw new Error(`Missing or mismatched multipart part ${reqPart.partNumber}`);
        }
        chunks.push(stored.data);
        total += stored.data.byteLength;
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      multipartSessions.delete(params.uploadId);
      return this.upload({
        bucket: session.bucket,
        path: session.path,
        data: merged,
        contentType: session.contentType,
        metadata: session.metadata,
        upsert: true,
      });
    },

    async abortMultipartUpload(params: StorageMultipartAbortParams): Promise<void> {
      multipartSessions.delete(params.uploadId);
    },

    async putPresigned(bucket: string, path: string, data: Buffer | Uint8Array, contentType = 'application/octet-stream'): Promise<void> {
      await this.upload({ bucket, path, data, contentType, upsert: true });
    },

    getObject(bucket: string, path: string): StoredMemoryObject | undefined {
      return store.get(toKey(bucket, path));
    },

    clear(): void {
      store.clear();
      multipartSessions.clear();
    },

    get size(): number {
      return store.size;
    },
  };
}
