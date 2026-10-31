import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  StorageAdapter,
  StorageFileEntry,
  StorageUploadParams,
  StorageUploadResult,
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
  const normalized = inputPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  if (parts.length === 0) {
    throw new Error('Invalid storage path');
  }
  return parts.join('/');
}

export function createLocalFsStorageAdapter(
  options: LocalFsStorageOptions,
): StorageAdapter {
  const resolvedRoot = path.resolve(options.rootDir);
  const baseUrl = (options.baseUrl ?? '/uploads').replace(/\/+$/, '');
  const includeBucket = options.includeBucketInPath !== false;

  const resolveDiskTarget = (bucket: string, relativePath: string) => {
    const cleanBucket = sanitizeRelativePath(bucket);
    const cleanRel = sanitizeRelativePath(relativePath);
    const subPath = includeBucket ? `${cleanBucket}/${cleanRel}` : cleanRel;
    const diskPath = path.resolve(resolvedRoot, subPath);

    if (!diskPath.startsWith(resolvedRoot)) {
      throw new Error('Path traversal blocked in LocalFsStorageAdapter');
    }

    return { diskPath, subPath, cleanRel };
  };

  const getPublicUrl = (bucket: string, relativePath: string): string => {
    const { subPath } = resolveDiskTarget(bucket, relativePath);
    return `${baseUrl}/${subPath}`;
  };

  return {
    async upload(params: StorageUploadParams): Promise<StorageUploadResult> {
      const { diskPath, cleanRel } = resolveDiskTarget(
        params.bucket,
        params.path,
      );

      if (params.upsert === false) {
        try {
          await fs.access(diskPath);
          throw new Error(
            `File already exists at ${params.bucket}/${cleanRel}`,
          );
        } catch (err) {
          if (
            err instanceof Error &&
            err.message.includes('File already exists')
          ) {
            throw err;
          }
        }
      }

      await fs.mkdir(path.dirname(diskPath), { recursive: true });
      await fs.writeFile(diskPath, params.data);

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

    getPublicUrl,

    async deleteByUrl(url: string): Promise<boolean> {
      if (!url || typeof url !== 'string') return false;

      try {
        const cleanUrl = url.split(/[?#]/)[0];
        const prefix = `${baseUrl}/`;
        let subPath: string | null = null;

        if (cleanUrl.startsWith(prefix)) {
          subPath = cleanUrl.slice(prefix.length);
        } else if (baseUrl.startsWith('/')) {
          const parsed = new URL(cleanUrl, 'http://localhost');
          const isLocal =
            parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
          const isRelative =
            !cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://');
          if ((isLocal || isRelative) && parsed.pathname.startsWith(prefix)) {
            subPath = parsed.pathname.slice(prefix.length);
          }
        }

        if (!subPath) return false;

        const decoded = decodeURIComponent(subPath)
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        if (!decoded) return false;

        const segments = decoded.split('/').filter(Boolean);
        if (
          segments.length === 0 ||
          segments.includes('..') ||
          segments.includes('.')
        ) {
          return false;
        }

        const diskPath = path.resolve(resolvedRoot, ...segments);
        const relative = path.relative(resolvedRoot, diskPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          return false;
        }

        await fs.unlink(diskPath);
        return true;
      } catch {
        return false;
      }
    },

    async list(bucket: string, folder?: string): Promise<StorageFileEntry[]> {
      const cleanBucket = sanitizeRelativePath(bucket);
      const cleanFolder = folder ? sanitizeRelativePath(folder) : '';
      const targetDir = path.resolve(
        resolvedRoot,
        includeBucket ? cleanBucket : '',
        cleanFolder,
      );

      if (!targetDir.startsWith(resolvedRoot)) {
        throw new Error('Path traversal blocked in LocalFsStorageAdapter');
      }

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

        return results;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw err;
      }
    },
  };
}
