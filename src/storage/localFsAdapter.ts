import fs from 'node:fs/promises';
import path from 'node:path';
import { isUploadKitError, UploadKitError } from '../types/errors';
import { normalizeStorageError, toStorageFailure } from './errorNormalizer';
import {
  type StorageAdapter, type StorageDownloadOptions, type StorageFileEntry,
  type StorageHealthCheckResult, type StorageListOptions, type StoragePaginatedListResult,
  type StorageUploadParams, type StorageUploadResult, toPaginatedListResult, validateStorageMetadata,
} from './types';

export interface LocalFsStorageOptions {
  /** Absolute or relative root directory on disk (e.g. `./public/uploads`) */
  rootDir: string;
  /** Public URL prefix matching `rootDir` (e.g. `/uploads` or `https://cdn.example.com/uploads`) */
  baseUrl?: string;
  /** Include the bucket segment as a subdirectory under `rootDir`. Defaults to `true`. */
  includeBucketInPath?: boolean;
}

function invalidPathError(message: string, code: 'STORAGE_ERROR' | 'FORBIDDEN'): UploadKitError {
  return new UploadKitError(message, { code, status: 400, retryable: false });
}

function sanitizeRelativePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') throw invalidPathError('Invalid storage path', 'STORAGE_ERROR');
  if (inputPath.includes(':') || inputPath.includes('\0')) {
    throw invalidPathError('Invalid storage path: path traversal blocked in LocalFsStorageAdapter', 'FORBIDDEN');
  }
  const rawSegments = inputPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean);
  if (rawSegments.length === 0) throw invalidPathError('Invalid storage path', 'STORAGE_ERROR');
  for (const segment of rawSegments) {
    if (segment === '.' || segment === '..') {
      throw invalidPathError('Invalid storage path: path traversal blocked', 'FORBIDDEN');
    }
  }
  return rawSegments.join('/');
}

function assertContainedInRoot(resolvedRoot: string, targetPath: string): void {
  const relative = path.relative(resolvedRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw invalidPathError('Invalid storage path: path traversal blocked in LocalFsStorageAdapter', 'FORBIDDEN');
  }
}

async function resolveDeepestRealPath(targetPath: string): Promise<string> {
  let current = targetPath;
  while (true) {
    try {
      const realCurrent = await fs.realpath(current);
      const remaining = path.relative(current, targetPath);
      return remaining ? path.resolve(realCurrent, remaining) : realCurrent;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      if (parent === current) return targetPath;
      current = parent;
    }
  }
}

async function assertRealPathContained(resolvedRoot: string, targetPath: string): Promise<void> {
  assertContainedInRoot(resolvedRoot, targetPath);
  const realRoot = await resolveDeepestRealPath(resolvedRoot);
  try {
    if ((await fs.lstat(targetPath)).isSymbolicLink()) {
      const resolvedLink = path.resolve(path.dirname(targetPath), await fs.readlink(targetPath));
      assertContainedInRoot(realRoot, await resolveDeepestRealPath(resolvedLink));
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  assertContainedInRoot(realRoot, await resolveDeepestRealPath(targetPath));
}

export interface LocalFsStorageAdapter extends StorageAdapter {
  exists(bucket: string, relativePath: string): Promise<boolean>;
  stat(bucket: string, relativePath: string): Promise<{ size: number; contentType?: string } | null>;
  getPublicUrl(bucket: string, relativePath: string): string;
  list(bucket: string, folder?: string, options?: StorageListOptions): Promise<StoragePaginatedListResult>;
  deleteByUrl(url: string): Promise<boolean>;
  parseUrl(url: string): { bucket?: string; path: string } | null;
  download(bucket: string, relativePath: string, options?: StorageDownloadOptions): Promise<Uint8Array>;
  healthCheck(): Promise<StorageHealthCheckResult>;
}

export function createLocalFsStorageAdapter(options: LocalFsStorageOptions): LocalFsStorageAdapter {
  const resolvedRoot = path.resolve(options.rootDir);
  const baseUrl = (options.baseUrl ?? '/uploads').replace(/\/+$/, '');
  const includeBucket = options.includeBucketInPath !== false;

  const resolveDiskTarget = (bucket: string, relativePath: string) => {
    const cleanBucket = sanitizeRelativePath(bucket);
    const cleanRel = sanitizeRelativePath(relativePath);
    const subPath = includeBucket ? `${cleanBucket}/${cleanRel}` : cleanRel;
    const diskPath = path.resolve(resolvedRoot, subPath);
    assertContainedInRoot(resolvedRoot, diskPath);
    return { diskPath, subPath, cleanRel };
  };

  const getPublicUrl = (bucket: string, relativePath: string): string =>
    `${baseUrl}/${resolveDiskTarget(bucket, relativePath).subPath}`;

  const parseUrl = (url: string): { bucket?: string; path: string } | null => {
    if (!url || typeof url !== 'string') return null;
    try {
      const cleanUrl = url.split(/[?#]/)[0];
      const prefix = `${baseUrl}/`;
      let subPath: string | null = null;
      if (cleanUrl.startsWith(prefix)) {
        subPath = cleanUrl.slice(prefix.length);
      } else if (baseUrl.startsWith('/')) {
        const parsed = new URL(cleanUrl, 'http://localhost');
        const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        const isRelative = !cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://');
        if ((isLocal || isRelative) && parsed.pathname.startsWith(prefix)) {
          subPath = parsed.pathname.slice(prefix.length);
        }
      }
      if (!subPath) return null;
      const decoded = decodeURIComponent(subPath).replace(/\\/g, '/').replace(/^\/+/, '');
      if (!decoded || decoded.includes(':') || decoded.includes('\0')) return null;
      const segments = decoded.split('/').filter(Boolean);
      if (segments.length === 0 || segments.includes('..') || segments.includes('.')) return null;
      const diskPath = path.resolve(resolvedRoot, ...segments);
      const relative = path.relative(resolvedRoot, diskPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
      if (includeBucket) {
        if (segments.length < 2) return null;
        return { bucket: segments[0], path: segments.slice(1).join('/') };
      }
      return { path: segments.join('/') };
    } catch {
      return null;
    }
  };

  return {
    async upload(params: StorageUploadParams): Promise<StorageUploadResult> {
      validateStorageMetadata(params.metadata);
      const { diskPath, cleanRel } = resolveDiskTarget(params.bucket, params.path);
      try {
        await assertRealPathContained(resolvedRoot, diskPath);
        await fs.mkdir(path.dirname(diskPath), { recursive: true });
        await assertRealPathContained(resolvedRoot, diskPath);
        await fs.writeFile(diskPath, params.data, params.upsert === false ? { flag: 'wx' } : undefined);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          const existsError = new Error(`File already exists at ${params.bucket}/${cleanRel}`) as NodeJS.ErrnoException;
          existsError.code = 'EEXIST';
          throw existsError;
        }
        throw toStorageFailure(err, { provider: 'local-fs', operation: 'upload' });
      }
      return { bucket: params.bucket, path: cleanRel, url: getPublicUrl(params.bucket, cleanRel) };
    },

    async delete(bucket: string, relativePath: string): Promise<void> {
      const { diskPath } = resolveDiskTarget(bucket, relativePath);
      await assertRealPathContained(resolvedRoot, diskPath);
      try {
        await fs.unlink(diskPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw toStorageFailure(err, { provider: 'local-fs', operation: 'delete' });
        }
      }
    },

    async exists(bucket: string, relativePath: string): Promise<boolean> {
      try {
        const { diskPath } = resolveDiskTarget(bucket, relativePath);
        await assertRealPathContained(resolvedRoot, diskPath);
        return (await fs.stat(diskPath)).isFile();
      } catch {
        return false;
      }
    },

    async stat(bucket: string, relativePath: string) {
      try {
        const { diskPath } = resolveDiskTarget(bucket, relativePath);
        await assertRealPathContained(resolvedRoot, diskPath);
        const fileStat = await fs.stat(diskPath);
        return fileStat.isFile() ? { size: fileStat.size } : null;
      } catch {
        return null;
      }
    },

    getPublicUrl,
    parseUrl,

    async download(
      bucket: string,
      relativePath: string,
      downloadOptions?: StorageDownloadOptions,
    ): Promise<Uint8Array> {
      const { diskPath } = resolveDiskTarget(bucket, relativePath);
      await assertRealPathContained(resolvedRoot, diskPath);
      try {
        if (downloadOptions?.maxBytes !== undefined) {
          const fileStat = await fs.stat(diskPath);
          if (fileStat.size > downloadOptions.maxBytes) {
            throw new UploadKitError('Staged file size exceeds maximum allowed bytes', {
              code: 'FILE_TOO_LARGE', status: 400, retryable: false,
            });
          }
        }
        const buf = await fs.readFile(diskPath);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (err) {
        throw toStorageFailure(err, { provider: 'local-fs', operation: 'download' });
      }
    },

    async deleteByUrl(url: string): Promise<boolean> {
      const parsed = parseUrl(url);
      if (!parsed) return false;
      try {
        const subSegments =
          includeBucket && parsed.bucket
            ? [parsed.bucket, ...parsed.path.split('/')]
            : parsed.path.split('/');
        const diskPath = path.resolve(resolvedRoot, ...subSegments);
        await assertRealPathContained(resolvedRoot, diskPath);
        await fs.unlink(diskPath);
        return true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || (isUploadKitError(err) && err.status === 400)) return false;
        throw toStorageFailure(err, { provider: 'local-fs', operation: 'delete' });
      }
    },

    async list(
      bucket: string,
      folder?: string,
      listOptions?: StorageListOptions,
    ): Promise<StoragePaginatedListResult> {
      const cleanBucket = sanitizeRelativePath(bucket);
      const cleanFolder = folder ? sanitizeRelativePath(folder) : '';
      const targetDir = path.resolve(resolvedRoot, includeBucket ? cleanBucket : '', cleanFolder);
      await assertRealPathContained(resolvedRoot, targetDir);

      try {
        const dirEntries = await fs.readdir(targetDir, { withFileTypes: true });
        const results: StorageFileEntry[] = [];
        for (const entry of dirEntries) {
          if (!entry.isFile()) continue;
          const full = path.join(targetDir, entry.name);
          const stat = await fs.stat(full);
          results.push({
            name: entry.name,
            id: entry.name,
            createdAt: stat.birthtime.toISOString(),
            size: stat.size,
          });
        }
        const offset = listOptions?.cursor ? Number(listOptions.cursor) || 0 : 0;
        const limit = listOptions?.limit ?? results.length;
        const sliced =
          listOptions?.limit !== undefined || offset > 0 ? results.slice(offset, offset + limit) : results;
        const nextCursor =
          listOptions?.limit !== undefined && offset + sliced.length < results.length
            ? String(offset + sliced.length)
            : undefined;
        return toPaginatedListResult(sliced, nextCursor);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return toPaginatedListResult([]);
        throw err;
      }
    },

    async healthCheck(): Promise<StorageHealthCheckResult> {
      const start = Date.now();
      try {
        await fs.mkdir(resolvedRoot, { recursive: true });
        await fs.access(resolvedRoot, fs.constants.R_OK | fs.constants.W_OK);
        return { ok: true, latencyMs: Date.now() - start };
      } catch (err) {
        const normalized = normalizeStorageError(err, { provider: 'local-fs', operation: 'healthCheck' });
        return { ok: false, latencyMs: Date.now() - start, message: normalized.message };
      }
    },
  };
}
