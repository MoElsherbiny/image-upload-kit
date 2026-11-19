import { createHash } from 'node:crypto';
import { UploadKitError } from '../types/errors';
import { normalizeStorageError } from './errorNormalizer';
import type { StorageAdapter } from './types';

export interface StorageMigrationFailure {
  path: string;
  error: string;
}

export interface StorageMigrationProgress {
  processed: number;
  copied: number;
  skipped: number;
  failed: number;
  deletedSource: number;
  currentPath: string;
}

export interface MigrateStorageOptions {
  source: StorageAdapter;
  target: StorageAdapter;
  sourceBucket: string;
  targetBucket?: string;
  folder?: string;
  cursor?: string;
  limit?: number;
  dryRun?: boolean;
  overwrite?: boolean;
  verifyIntegrity?: boolean;
  deleteSource?: boolean;
  confirmDestructive?: boolean;
  onProgress?: (progress: StorageMigrationProgress) => void | Promise<void>;
}

export interface StorageMigrationResult {
  copied: number;
  skipped: number;
  failed: number;
  deletedSource: number;
  nextCursor?: string;
  dryRun: boolean;
  failures: StorageMigrationFailure[];
}

const EXT_MIME_MAP: Record<string, string> = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function inferContentType(objectPath: string): string {
  const dot = objectPath.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  const ext = objectPath.slice(dot).toLowerCase();
  return EXT_MIME_MAP[ext] ?? 'application/octet-stream';
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Resumable, cursor-paginated storage migration utility with optional dry-run,
 * SHA-256 post-copy integrity verification, and guarded source deletion.
 */
export async function migrateStorage(
  options: MigrateStorageOptions,
): Promise<StorageMigrationResult> {
  const {
    source,
    target,
    sourceBucket,
    folder,
    cursor,
    limit,
    dryRun = false,
    overwrite = false,
    verifyIntegrity = false,
    deleteSource = false,
    confirmDestructive = false,
    onProgress,
  } = options;

  if (deleteSource && !confirmDestructive) {
    throw new UploadKitError(
      'Refusing destructive migration: deleteSource requires explicit confirmDestructive: true',
      { code: 'FORBIDDEN', status: 400, retryable: false },
    );
  }

  if (!source.list) {
    throw new UploadKitError('Source StorageAdapter must implement list() for migration', {
      code: 'STORAGE_ERROR',
      status: 400,
      retryable: false,
    });
  }
  if (!dryRun && !source.download) {
    throw new UploadKitError('Source StorageAdapter must implement download() for migration', {
      code: 'STORAGE_ERROR',
      status: 400,
      retryable: false,
    });
  }
  if (!dryRun && verifyIntegrity && !target.download) {
    throw new UploadKitError(
      'Target StorageAdapter must implement download() when verifyIntegrity is enabled',
      { code: 'STORAGE_ERROR', status: 400, retryable: false },
    );
  }

  const targetBucket = options.targetBucket ?? sourceBucket;
  const cleanFolder = folder ? folder.replace(/^\/+|\/+$/g, '') : '';
  const listed = await source.list(sourceBucket, cleanFolder || undefined, {
    ...(cursor ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  let deletedSource = 0;
  let processed = 0;
  const failures: StorageMigrationFailure[] = [];

  for (const entry of listed.items) {
    const fullPath = cleanFolder ? `${cleanFolder}/${entry.name}` : entry.name;
    try {
      const alreadyExists = !overwrite && target.exists
        ? await target.exists(targetBucket, fullPath)
        : false;

      if (alreadyExists || dryRun) {
        skipped++;
      } else {
        const bytes = await source.download!(sourceBucket, fullPath);
        const sourceHash = verifyIntegrity ? sha256Hex(bytes) : undefined;
        const stat = source.stat ? await source.stat(sourceBucket, fullPath) : null;
        const contentType = stat?.contentType ?? inferContentType(fullPath);

        await target.upload({
          bucket: targetBucket,
          path: fullPath,
          data: bytes,
          contentType,
          upsert: overwrite,
          ...(sourceHash ? { contentHash: sourceHash } : {}),
        });

        if (verifyIntegrity && sourceHash) {
          const targetBytes = await target.download!(targetBucket, fullPath);
          const targetHash = sha256Hex(targetBytes);
          if (targetHash !== sourceHash) {
            throw new UploadKitError(
              `Integrity verification failed for ${fullPath}: SHA-256 mismatch`,
              { code: 'STORAGE_ERROR', status: 500, retryable: true },
            );
          }
        }

        copied++;

        if (deleteSource && confirmDestructive) {
          await source.delete(sourceBucket, fullPath);
          deletedSource++;
        }
      }
    } catch (err) {
      failed++;
      const normalized = normalizeStorageError(err, {
        provider: 'migration',
        operation: 'migrate',
        bucket: sourceBucket,
        path: fullPath,
      });
      failures.push({ path: fullPath, error: normalized.message });
    }

    processed++;
    await onProgress?.({
      processed,
      copied,
      skipped,
      failed,
      deletedSource,
      currentPath: fullPath,
    });
  }

  return {
    copied,
    skipped,
    failed,
    deletedSource,
    nextCursor: listed.nextCursor,
    dryRun,
    failures,
  };
}
