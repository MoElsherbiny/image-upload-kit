import fs from 'node:fs';
import path from 'node:path';
import type {
  StorageAdapter,
  StorageUploadResult,
} from '../../storage/types';
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

/**
 * Determines whether a storage error represents a filename or object collision.
 * Matches `already exists` or `EEXIST`, while strictly excluding `does not exist`
 * (e.g. non-existent buckets, directories, or missing keys).
 */
export function isCollisionError(e: unknown): boolean {
  if (!e) return false;

  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code).toUpperCase()
      : '';

  if (code === 'EEXIST') {
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
    msg.includes('file exists')
  );
}

/**
 * Uploads optimized image bytes to the storage backend with automatic filename
 * collision retries (or immediate `upsert: true` fallback when `customFilename` is set).
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

  let storageTarget = buildPath(pathContext);
  let uploadResult: StorageUploadResult | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      uploadResult = await storage.upload({
        bucket: storageTarget.bucket,
        path: storageTarget.path,
        data,
        contentType,
        upsert: Boolean(pathContext.customFilename),
        contentHash: pathContext.contentHash,
        metadata: pathContext.metadata,
      });
      break;
    } catch (e) {
      if (isCollisionError(e)) {
        if (pathContext.customFilename) {
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
  fallbackUrl: string;
  mirrorDir?: string;
  publicUrlBase?: string;
}

/**
 * Mirrors an uploaded image buffer to a local directory when `mirrorDir` is configured.
 * Safely swallows read-only filesystem errors on serverless runtimes and resolves
 * `publicUrlBase` when local mirroring succeeds.
 */
export function mirrorBufferLocally(
  options: MirrorBufferLocallyOptions,
): string {
  const { buffer, filename, fallbackUrl, mirrorDir, publicUrlBase } = options;
  if (!mirrorDir) {
    return fallbackUrl;
  }

  try {
    if (!fs.existsSync(mirrorDir)) {
      fs.mkdirSync(mirrorDir, { recursive: true });
    }
    fs.writeFileSync(path.join(mirrorDir, filename), buffer);
    if (publicUrlBase) {
      return `${publicUrlBase.replace(/\/+$/, '')}/${filename}`;
    }
  } catch {
    // Safely ignored on read-only serverless filesystems
  }

  return fallbackUrl;
}
