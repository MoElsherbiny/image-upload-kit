import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type StorageAdapter,
  type StorageDownloadOptions,
  type StorageFileEntry,
  type StorageListOptions,
  type StoragePaginatedListResult,
  type StorageUploadParams,
  type StorageUploadResult,
  toPaginatedListResult,
  validateStorageMetadata,
} from './types';

export interface LocalFsStorageOptions {
  /** Absolute or relative root directory on disk (e.g. `./public/uploads`) */
  rootDir: string;
  /** Public URL prefix matching `rootDir` (e.g. `/uploads` or `https://cdn.example.com/uploads`) */
  baseUrl?: string;
  /** Include the bucket segment as a subdirectory under `rootDir`. Defaults to `true`. */
  includeBucketInPath?: boolean;
}

function sanitizeRelativePath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') throw new Error('Invalid storage path');
  if (inputPath.includes(':') || inputPath.includes('\0')) {
    throw new Error('Path traversal blocked in LocalFsStorageAdapter');
  }
  const rawSegments = inputPath.replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean);
  if (rawSegments.length === 0) throw new Error('Invalid storage path');
  for (const segment of rawSegments) {
    if (segment === '.' || segment === '..') {
      throw new Error('Invalid storage path: path traversal blocked');
    }
  }
  return rawSegments.join('/');
}

function assertContainedInRoot(resolvedRoot: string, targetPath: string): void {
  const relative = path.relative(resolvedRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path traversal blocked in LocalFsStorageAdapter');
  }
}

export interface LocalFsStorageAdapter extends StorageAdapter {
  exists(bucket: string, relativePath: string): Promise<boolean>;
  stat(bucket: string, relativePath: string): Promise<{ size: number; contentType?: string } | null>;
  getPublicUrl(bucket: string, relativePath: string): string;
  list(bucket: string, folder?: string, options?: StorageListOptions): Promise<StoragePaginatedListResult>;
  deleteByUrl(url: string): Promise<boolean>;
  parseUrl(url: string): { bucket?: string; path: string } | null;
  download(bucket: string, relativePath: string, options?: StorageDownloadOptions): Promise<Uint8Array>;
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
      const { diskPath, cleanRel } = resolveDiskTarget(
        params.bucket,
        params.path,
      );

      await fs.mkdir(path.dirname(diskPath), { recursive: true });

      try {
        await fs.writeFile(
          diskPath,
          params.data,
          params.upsert === false ? { flag: 'wx' } : undefined,
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          const existsError = new Error(
            `File already exists at ${params.bucket}/${cleanRel}`,
          ) as NodeJS.ErrnoException;
          existsError.code = 'EEXIST';
          throw existsError;
        }
        throw err;
      }

      return {
        bucket: params.bucket,
        path: cleanRel,
        url: getPublicUrl(params.bucket, cleanRel),
      };
    },

    async delete(bucket: string, relativePath: string): Promise<void> {
      const { diskPath } = resolveDiskTarget(bucket, relativePath);
      try {
        await fs.unlink(diskPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    },

    async exists(bucket: string, relativePath: string): Promise<boolean> {
      try {
        const { diskPath } = resolveDiskTarget(bucket, relativePath);
        return (await fs.stat(diskPath)).isFile();
      } catch {
        return false;
      }
    },

    async stat(bucket: string, relativePath: string) {
      try {
        const { diskPath } = resolveDiskTarget(bucket, relativePath);
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
      if (downloadOptions?.maxBytes !== undefined) {
        const fileStat = await fs.stat(diskPath);
        if (fileStat.size > downloadOptions.maxBytes) {
          const err = new Error('Staged file size exceeds maximum allowed bytes') as Error & {
            status?: number;
          };
          err.status = 400;
          throw err;
        }
      }
      const buf = await fs.readFile(diskPath);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
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
        assertContainedInRoot(resolvedRoot, diskPath);
        await fs.unlink(diskPath);
        return true;
      } catch {
        return false;
      }
    },

    async list(
      bucket: string,
      folder?: string,
      listOptions?: StorageListOptions,
    ): Promise<StoragePaginatedListResult> {
      const cleanBucket = sanitizeRelativePath(bucket);
      const cleanFolder = folder ? sanitizeRelativePath(folder) : '';
      const targetDir = path.resolve(
        resolvedRoot,
        includeBucket ? cleanBucket : '',
        cleanFolder,
      );

      assertContainedInRoot(resolvedRoot, targetDir);

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
          listOptions?.limit !== undefined || offset > 0
            ? results.slice(offset, offset + limit)
            : results;
        const nextCursor =
          listOptions?.limit !== undefined && offset + sliced.length < results.length
            ? String(offset + sliced.length)
            : undefined;

        return toPaginatedListResult(sliced, nextCursor);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return toPaginatedListResult([]);
        }
        throw err;
      }
    },
  };
}
