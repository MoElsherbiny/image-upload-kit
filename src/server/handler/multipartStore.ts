import type { StorageMultipartPartResult } from '../../storage/types';
import { UploadKitError } from '../../types/errors';

export interface MultipartSessionRecord {
  uploadId: string;
  bucket: string;
  path: string;
  subject?: string;
  /** Sum of the latest byte size recorded for each distinct part number. */
  receivedBytes: number;
  /** Latest byte size per part number (re-uploading a part replaces its size instead of adding to it). */
  partSizes?: Record<number, number>;
  createdAt: number;
  expiresAt: number;
}

export interface MultipartSessionStore {
  create(session: MultipartSessionRecord): Promise<void> | void;
  get(uploadId: string): Promise<MultipartSessionRecord | null | undefined> | MultipartSessionRecord | null | undefined;
  /**
   * Records the byte size of `partNumber`, replacing any previous size for the same part,
   * and returns the updated record. Preferred over `addBytes` when implemented.
   */
  recordPart?(uploadId: string, partNumber: number, bytes: number): Promise<MultipartSessionRecord | null | undefined> | MultipartSessionRecord | null | undefined;
  /** @deprecated Additive accounting double-counts re-uploaded parts; implement `recordPart` instead. */
  addBytes?(uploadId: string, bytes: number): Promise<MultipartSessionRecord | null | undefined> | MultipartSessionRecord | null | undefined;
  delete(uploadId: string): Promise<void> | void;
}

export interface MemoryMultipartSessionStoreOptions {
  maxSessions?: number;
  ttlMs?: number;
  now?: () => number;
}

export const DEFAULT_MULTIPART_MAX_SESSIONS = 500;
export const DEFAULT_MULTIPART_SESSION_TTL_MS = 3_600_000;

/** Bytes already accounted for every part except `partNumber` (which is about to be (re)uploaded). */
export function bytesExcludingPart(session: MultipartSessionRecord, partNumber: number): number {
  const previous = session.partSizes?.[partNumber] ?? 0;
  return Math.max(0, session.receivedBytes - previous);
}

export function parsePartsList(raw: unknown): StorageMultipartPartResult[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const parts: StorageMultipartPartResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const { partNumber, etag } = item as { partNumber?: unknown; etag?: unknown };
    if (typeof partNumber !== 'number' || !Number.isInteger(partNumber) || partNumber < 1 || typeof etag !== 'string' || etag.trim().length === 0) {
      return null;
    }
    parts.push({ partNumber, etag });
  }
  return parts;
}

function cloneRecord(entry: MultipartSessionRecord): MultipartSessionRecord {
  return { ...entry, ...(entry.partSizes ? { partSizes: { ...entry.partSizes } } : {}) };
}

/** Dev/single-instance bounded TTL-evicting in-memory `MultipartSessionStore`. */
export function createMemoryMultipartSessionStore(
  options: MemoryMultipartSessionStoreOptions = {},
): MultipartSessionStore {
  const maxSessions = Math.max(1, Math.floor(options.maxSessions ?? DEFAULT_MULTIPART_MAX_SESSIONS));
  const ttlMs = Math.max(1, Math.floor(options.ttlMs ?? DEFAULT_MULTIPART_SESSION_TTL_MS));
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, MultipartSessionRecord>();

  const pruneExpired = (): void => {
    const ts = now();
    for (const [id, entry] of sessions) {
      if (entry.expiresAt <= ts) sessions.delete(id);
    }
  };

  return {
    create(session) {
      pruneExpired();
      if (!sessions.has(session.uploadId) && sessions.size >= maxSessions) {
        throw new UploadKitError('Maximum active multipart upload sessions reached', { code: 'RESOURCE_LIMIT_EXCEEDED', status: 503 });
      }
      const createdAt = session.createdAt || now();
      const expiresAt = session.expiresAt ? Math.min(session.expiresAt, createdAt + ttlMs) : createdAt + ttlMs;
      sessions.set(session.uploadId, { ...cloneRecord(session), createdAt, expiresAt });
    },
    get(uploadId) {
      const entry = sessions.get(uploadId);
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        sessions.delete(uploadId);
        return null;
      }
      return cloneRecord(entry);
    },
    recordPart(uploadId, partNumber, bytes) {
      const entry = sessions.get(uploadId);
      if (!entry) return null;
      const partSizes = { ...entry.partSizes, [partNumber]: Math.max(0, bytes) };
      entry.partSizes = partSizes;
      entry.receivedBytes = Object.values(partSizes).reduce((sum, size) => sum + size, 0);
      return cloneRecord(entry);
    },
    addBytes(uploadId, bytes) {
      const entry = sessions.get(uploadId);
      if (!entry) return null;
      entry.receivedBytes += Math.max(0, bytes);
      return cloneRecord(entry);
    },
    delete(uploadId) {
      sessions.delete(uploadId);
    },
  };
}
