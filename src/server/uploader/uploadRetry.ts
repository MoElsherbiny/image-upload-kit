import fs from 'node:fs/promises';
import path from 'node:path';
import {
  hasStorageErrorMetadata,
  normalizeStorageError,
} from '../../storage/errorNormalizer';
import type {
  StorageAdapter,
  StorageUploadResult,
} from '../../storage/types';
import { isUploadKitError } from '../../types/errors';
import { safeReportUploaderError, throwIfAborted } from './inFlightCoalescer';
import { stripFilenameExtension } from './pathGenerator';
import type {
  GeneratedStorageTarget,
  StoragePathContext,
  StoragePathGenerator,
  UploaderErrorHook,
} from './types';

export interface UploadWithCollisionRetryParams {
  storage: StorageAdapter;
  buildPath: StoragePathGenerator;
  pathContext: StoragePathContext;
  data: Buffer | Uint8Array;
  contentType: string;
  maxRetries?: number;
  signal?: AbortSignal;
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

function isDirectCollisionError(e: unknown): boolean {
  if (!e) return false;
  const obj = typeof e === 'object' ? (e as Record<string, unknown>) : null;
  const code = obj && 'code' in obj ? String(obj.code).toUpperCase() : '';
  const statusCode =
    obj && '$metadata' in obj
      ? (obj.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode
      : obj && 'statusCode' in obj
        ? Number(obj.statusCode)
        : obj && 'status' in obj
          ? Number(obj.status)
          : undefined;

  if (code === 'EEXIST' || code === 'PRECONDITIONFAILED' || statusCode === 412) {
    return true;
  }
  if (code === 'ENOENT') return false;

  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  if (
    msg.includes('does not exist') ||
    msg.includes("doesn't exist") ||
    msg.includes('not exist') ||
    msg.includes('enoent')
  ) {
    return false;
  }

  return (
    msg.includes('already exists') ||
    msg.includes('already_exists') ||
    msg.includes('eexist') ||
    msg.includes('file exists') ||
    msg.includes('precondition failed')
  );
}

/**
 * Determines whether a storage error (or its nested `cause`) represents a filename
 * or object collision (`already exists`, `EEXIST`, or HTTP 412 Precondition Failed).
 */
export function isCollisionError(e: unknown): boolean {
  let current: unknown = e;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (isDirectCollisionError(current)) return true;
    const cause =
      current instanceof Error && 'cause' in current ? current.cause : undefined;
    if (!cause || cause === current) break;
    current = cause;
  }
  return false;
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
    storage, buildPath, pathContext, data, contentType, maxRetries = 3, signal,
  } = params;

  const isServerCustomName =
    Boolean(pathContext.customFilename) && !pathContext.isClientFilename;

  let storageTarget = buildPath(pathContext);
  let uploadResult: StorageUploadResult | undefined;
  let lastCollisionError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    throwIfAborted(signal);
    try {
      uploadResult = await storage.upload({
        bucket: storageTarget.bucket,
        path: storageTarget.path,
        data,
        contentType,
        upsert: isServerCustomName,
        contentHash: pathContext.contentHash,
        metadata: pathContext.metadata,
        ...(signal ? { signal } : {}),
      });
      break;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      if (isCollisionError(e)) {
        lastCollisionError = e;
        if (isServerCustomName) {
          throwIfAborted(signal);
          uploadResult = await storage.upload({
            bucket: storageTarget.bucket,
            path: storageTarget.path,
            data,
            contentType,
            upsert: true,
            contentHash: pathContext.contentHash,
            metadata: pathContext.metadata,
            ...(signal ? { signal } : {}),
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
      if (!isUploadKitError(e) && hasStorageErrorMetadata(e)) {
        throw normalizeStorageError(e, { operation: 'upload' });
      }
      throw e;
    }
  }

  if (!uploadResult) {
    throw normalizeStorageError(
      lastCollisionError ?? { statusCode: 409, code: 'EEXIST' },
      { operation: 'upload' },
    );
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
  onError?: UploaderErrorHook,
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
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code !== 'ENOENT' && code !== 'EROFS') {
          safeReportUploaderError(onError, err, 'cleanup');
        }
      }
    }),
  );
}
