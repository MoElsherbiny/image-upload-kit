import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  StorageAdapter,
  StorageUploadResult,
} from '../../storage/types';
import { stripFilenameExtension } from './pathGenerator';
import type {
  GeneratedStorageTarget,
  StoragePathContext,
  StoragePathGenerator,
} from './types';

export interface UploadWithCollisionRetryParams {
  storage: StorageAdapter;
  buildPath: StoragePathGenerator;
  pathContext: StoragePathContext;
  data: Buffer | Uint8Array;
  contentType: string;
  maxRetries?: number;
}

export interface UploadWithCollisionRetryResult {
  uploadResult: StorageUploadResult;
  storageTarget: GeneratedStorageTarget;
}

function randomRetrySuffix(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10);
}

/**
 * Determines whether a storage error represents a filename or object collision.
 * Matches `already exists`, `EEXIST`, or HTTP 412 Precondition Failed, while strictly
 * excluding `does not exist` (e.g. non-existent buckets, directories, or missing keys).
 */
export function isCollisionError(e: unknown): boolean {
  if (!e) return false;

  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code).toUpperCase()
      : '';
  const statusCode =
    typeof e === 'object' && e !== null && '$metadata' in e
      ? (e as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode
      : typeof e === 'object' && e !== null && 'statusCode' in e
        ? Number((e as { statusCode: unknown }).statusCode)
        : undefined;

  if (code === 'EEXIST' || code === 'PRECONDITIONFAILED' || statusCode === 412) {
    return true;
  }
  if (code === 'ENOENT') {
    return false;
  }

  const msg =
    e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();

  // Strictly exclude non-existence errors (missing bucket, directory, key)
  if (
    msg.includes('does not exist') ||
    msg.includes("doesn't exist") ||
    msg.includes('not exist') ||
    msg.includes('enoent')
  ) {
    return false;
  }

  // Match genuine collision indicators
  return (
    msg.includes('already exists') ||
    msg.includes('already_exists') ||
    msg.includes('eexist') ||
    msg.includes('file exists') ||
    msg.includes('precondition failed')
  );
}

/**
 * Uploads optimized image bytes to the storage backend with automatic filename
 * collision retries. Server-side `customFilename` uses `upsert: true`, while
 * client-supplied `customFilename` (`isClientFilename: true`) never upserts and
 * appends a unique suffix on collision.
 */
export async function uploadWithCollisionRetry(
  params: UploadWithCollisionRetryParams,
): Promise<UploadWithCollisionRetryResult> {
  const {
    storage,
    buildPath,
    pathContext,
    data,
    contentType,
    maxRetries = 3,
  } = params;

  const isServerCustomName =
    Boolean(pathContext.customFilename) && !pathContext.isClientFilename;

  let storageTarget = buildPath(pathContext);
  let uploadResult: StorageUploadResult | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      uploadResult = await storage.upload({
        bucket: storageTarget.bucket,
        path: storageTarget.path,
        data,
        contentType,
        upsert: isServerCustomName,
        contentHash: pathContext.contentHash,
        metadata: pathContext.metadata,
      });
      break;
    } catch (e) {
      if (isCollisionError(e)) {
        if (isServerCustomName) {
          uploadResult = await storage.upload({
            bucket: storageTarget.bucket,
            path: storageTarget.path,
            data,
            contentType,
            upsert: true,
            contentHash: pathContext.contentHash,
            metadata: pathContext.metadata,
          });
          break;
        }
        if (pathContext.customFilename && pathContext.isClientFilename) {
          const base = stripFilenameExtension(pathContext.customFilename);
          storageTarget = buildPath({
            ...pathContext,
            customFilename: `${base}-${randomRetrySuffix()}`,
          });
          continue;
        }
        storageTarget = buildPath({
          ...pathContext,
          customFilename: undefined,
        });
        continue;
      }
      throw e;
    }
  }

  if (!uploadResult) {
    throw new Error('Failed to upload image after multiple retries');
  }

  return { uploadResult, storageTarget };
}

export interface MirrorBufferLocallyOptions {
  buffer: Buffer | Uint8Array;
  filename: string;
  storagePath?: string;
  fallbackUrl: string;
  mirrorDir?: string;
  publicUrlBase?: string;
}

/**
 * Mirrors an uploaded image buffer to a local directory when `mirrorDir` is configured.
 * Uses non-blocking `fs/promises` I/O, safely swallows read-only filesystem errors on
 * serverless runtimes, and resolves `publicUrlBase` when local mirroring succeeds.
 */
export async function mirrorBufferLocally(
  options: MirrorBufferLocallyOptions,
): Promise<string> {
  const {
    buffer,
    filename,
    storagePath,
    fallbackUrl,
    mirrorDir,
    publicUrlBase,
  } = options;
  if (!mirrorDir) {
    return fallbackUrl;
  }

  const relativeTarget = (storagePath || filename).replace(/^\/+/, '');

  try {
    const resolvedBase = path.resolve(mirrorDir);
    const destPath = path.resolve(resolvedBase, relativeTarget);
    const rel = path.relative(resolvedBase, destPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return fallbackUrl;
    }
    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(destPath, buffer);
    if (publicUrlBase) {
      return `${publicUrlBase.replace(/\/+$/, '')}/${relativeTarget}`;
    }
  } catch {
    // Safely ignored on read-only serverless filesystems
  }

  return fallbackUrl;
}

/**
 * Deletes any locally mirrored copy of `storagePath` across configured `mirrorDirs`.
 */
export async function deleteMirroredFiles(
  mirrorDirs: string[],
  storagePath: string,
): Promise<void> {
  if (!mirrorDirs.length || !storagePath) return;
  const relativeTarget = storagePath.replace(/^\/+/, '');
  if (!relativeTarget) return;

  await Promise.all(
    mirrorDirs.map(async (dir) => {
      try {
        const resolvedBase = path.resolve(dir);
        const destPath = path.resolve(resolvedBase, relativeTarget);
        const rel = path.relative(resolvedBase, destPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) return;
        await fs.unlink(destPath);
      } catch {
        // Ignore ENOENT or read-only fs errors
      }
    }),
  );
}
