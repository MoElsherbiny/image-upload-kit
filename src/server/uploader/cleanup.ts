import type { StorageAdapter } from '../../storage/types';
import { UploadKitError } from '../../types/errors';
import type {
  ResumableSessionRecord,
  ResumableSessionStore,
} from '../handler/resumableRoute';

export interface CleanupStagingObjectsOptions {
  storage: StorageAdapter;
  bucket: string;
  /** Explicit staging prefix (required, non-empty) so live objects can never be deleted by accident. */
  stagingPrefix: string;
  /** Explicit maximum object age in milliseconds (required, must be > 0). */
  maxAgeMs: number;
  /** When `true`, reports expired objects without deleting them (default: `false`). */
  dryRun?: boolean;
  /** Reference timestamp in ms (default: `Date.now()`). */
  now?: number;
  /** Optional page size for paginated `storage.list` calls. */
  pageSize?: number;
}

export interface CleanupStagingObjectsResult {
  scanned: number;
  expired: number;
  deleted: number;
  dryRun: boolean;
  paths: string[];
}

export interface CleanupResumableSessionsOptions {
  /** Explicit maximum session age in milliseconds (required, must be > 0). */
  maxAgeMs: number;
  /** When `true`, reports abandoned sessions without deleting them (default: `false`). */
  dryRun?: boolean;
  /** Reference timestamp in ms (default: `Date.now()`). */
  now?: number;
}

export interface CleanupResumableSessionsResult {
  expired: number;
  deleted: number;
  dryRun: boolean;
  sessionIds: string[];
}

/**
 * Safely sweeps expired objects inside an explicit staging prefix.
 * Refuses to execute unless both `stagingPrefix` (non-empty) and `maxAgeMs` (> 0) are provided.
 */
export async function cleanupExpiredStagingObjects(
  options: CleanupStagingObjectsOptions,
): Promise<CleanupStagingObjectsResult> {
  const { storage, bucket, stagingPrefix, maxAgeMs, pageSize } = options;
  const dryRun = options.dryRun === true;
  const now = options.now ?? Date.now();

  const cleanPrefix =
    typeof stagingPrefix === 'string'
      ? stagingPrefix.trim().replace(/^\/+|\/+$/g, '')
      : '';
  if (!cleanPrefix) {
    throw new UploadKitError(
      'cleanupExpiredStagingObjects requires an explicit non-empty stagingPrefix',
      { code: 'INVALID_IMAGE', status: 400 },
    );
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new UploadKitError(
      'cleanupExpiredStagingObjects requires a positive maxAgeMs',
      { code: 'INVALID_IMAGE', status: 400 },
    );
  }

  if (typeof storage.list !== 'function') {
    return { scanned: 0, expired: 0, deleted: 0, dryRun, paths: [] };
  }

  let cursor: string | undefined;
  let scanned = 0;
  let deleted = 0;
  const expiredPaths: string[] = [];

  do {
    const page = await storage.list(bucket, cleanPrefix, {
      ...(cursor ? { cursor } : {}),
      ...(pageSize ? { limit: pageSize } : {}),
    });

    for (const entry of page) {
      scanned++;
      if (!entry.createdAt) continue;
      const createdMs = Date.parse(entry.createdAt);
      if (!Number.isFinite(createdMs) || now - createdMs < maxAgeMs) continue;

      const fullPath = entry.name.startsWith(`${cleanPrefix}/`)
        ? entry.name
        : `${cleanPrefix}/${entry.name}`;
      expiredPaths.push(fullPath);

      if (!dryRun) {
        await storage.delete(bucket, fullPath);
        deleted++;
      }
    }

    cursor = page.nextCursor;
  } while (cursor);

  return {
    scanned,
    expired: expiredPaths.length,
    deleted,
    dryRun,
    paths: expiredPaths,
  };
}

/**
 * Safely sweeps expired or abandoned resumable upload sessions from a `ResumableSessionStore`.
 * Refuses to execute unless a positive `maxAgeMs` is provided.
 */
export async function cleanupAbandonedResumableSessions(
  store: ResumableSessionStore,
  options: CleanupResumableSessionsOptions,
): Promise<CleanupResumableSessionsResult> {
  const { maxAgeMs } = options;
  const dryRun = options.dryRun === true;
  const now = options.now ?? Date.now();

  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new UploadKitError(
      'cleanupAbandonedResumableSessions requires a positive maxAgeMs',
      { code: 'INVALID_IMAGE', status: 400 },
    );
  }

  let expiredSessions: ResumableSessionRecord[] = [];
  if (typeof store.listExpired === 'function') {
    expiredSessions = await store.listExpired(now, maxAgeMs);
  } else if (typeof store.listAll === 'function') {
    const all = await store.listAll();
    expiredSessions = all.filter(
      (s) => s.expiresAt <= now || now - s.createdAt >= maxAgeMs,
    );
  }

  const sessionIds = expiredSessions.map((s) => s.id);
  let deleted = 0;
  if (!dryRun) {
    for (const id of sessionIds) {
      await store.delete(id);
      deleted++;
    }
  }

  return {
    expired: sessionIds.length,
    deleted,
    dryRun,
    sessionIds,
  };
}
