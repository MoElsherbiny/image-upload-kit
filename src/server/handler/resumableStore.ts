import { UploadKitError } from '../../types/errors';

export interface ResumableSessionRecord {
  id: string;
  subject?: string;
  filename: string;
  contentType: string;
  totalSize: number;
  chunkSize: number;
  receivedBytes: number;
  bucket?: string;
  folder?: string;
  preset?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ResumableSessionStore {
  create(session: ResumableSessionRecord): Promise<void> | void;
  get(sessionId: string): Promise<ResumableSessionRecord | null | undefined> | ResumableSessionRecord | null | undefined;
  appendChunk(sessionId: string, offset: number, data: Uint8Array): Promise<ResumableSessionRecord> | ResumableSessionRecord;
  assemble(sessionId: string): Promise<Uint8Array> | Uint8Array;
  delete(sessionId: string): Promise<void> | void;
  claimForCompletion?(sessionId: string): Promise<boolean> | boolean;
  /** Releases a previous `claimForCompletion` lock after a retryable `complete` failure. */
  releaseCompletion?(sessionId: string): Promise<void> | void;
  listExpired?(now: number, maxAgeMs?: number): Promise<ResumableSessionRecord[]> | ResumableSessionRecord[];
  listAll?(): Promise<ResumableSessionRecord[]> | ResumableSessionRecord[];
}

export interface MemoryResumableSessionStoreOptions {
  maxSessions?: number;
  maxTotalBytes?: number;
  now?: () => number;
}

export const DEFAULT_RESUMABLE_SESSION_TTL_MS = 3_600_000;
const DEFAULT_MAX_SESSIONS = 500;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

interface MemoryEntry {
  record: ResumableSessionRecord;
  chunks: Map<number, Uint8Array>;
  bufferedBytes: number;
  completing: boolean;
}

/** Dev/single-instance bounded in-memory `ResumableSessionStore`. */
export function createMemoryResumableSessionStore(
  options: MemoryResumableSessionStoreOptions = {},
): ResumableSessionStore {
  const maxSessions = Math.max(1, Math.floor(options.maxSessions ?? DEFAULT_MAX_SESSIONS));
  const maxTotalBytes = Math.max(1, Math.floor(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES));
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, MemoryEntry>();
  let totalBufferedBytes = 0;

  const pruneExpired = (): void => {
    const ts = now();
    for (const [id, entry] of sessions) {
      if (entry.record.expiresAt <= ts) {
        totalBufferedBytes = Math.max(0, totalBufferedBytes - entry.bufferedBytes);
        sessions.delete(id);
      }
    }
  };
  const limitErr = (msg: string) => new UploadKitError(msg, { code: 'RESOURCE_LIMIT_EXCEEDED', status: 503 });
  const notFoundErr = () => new UploadKitError('Resumable upload session not found', { code: 'INVALID_UPLOAD_TOKEN', status: 404 });

  return {
    create(session) {
      if ((!sessions.has(session.id) && sessions.size >= maxSessions) || totalBufferedBytes + session.totalSize > maxTotalBytes) {
        pruneExpired();
      }
      if (!sessions.has(session.id) && sessions.size >= maxSessions) throw limitErr('Maximum active resumable upload sessions reached');
      if (totalBufferedBytes + session.totalSize > maxTotalBytes) throw limitErr('Resumable upload memory limit exceeded');
      sessions.set(session.id, { record: { ...session }, chunks: new Map(), bufferedBytes: 0, completing: false });
    },
    get(sessionId) {
      const entry = sessions.get(sessionId);
      return entry ? { ...entry.record } : null;
    },
    appendChunk(sessionId, offset, data) {
      const entry = sessions.get(sessionId);
      if (!entry) throw notFoundErr();
      const delta = data.byteLength - (entry.chunks.get(offset)?.byteLength ?? 0);
      if (totalBufferedBytes + delta > maxTotalBytes) {
        pruneExpired();
        if (!sessions.has(sessionId)) throw notFoundErr();
      }
      if (totalBufferedBytes + delta > maxTotalBytes) throw limitErr('Resumable upload memory limit exceeded');
      entry.chunks.set(offset, new Uint8Array(data));
      entry.bufferedBytes += delta;
      totalBufferedBytes += delta;
      let end = 0;
      for (const off of [...entry.chunks.keys()].sort((a, b) => a - b)) {
        if (off > end) break;
        end = Math.max(end, off + entry.chunks.get(off)!.byteLength);
      }
      entry.record.receivedBytes = end;
      return { ...entry.record };
    },
    assemble(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) throw notFoundErr();
      const merged = new Uint8Array(entry.record.totalSize);
      let cursor = 0;
      for (const off of [...entry.chunks.keys()].sort((a, b) => a - b)) {
        if (off !== cursor) throw new UploadKitError('Resumable upload has missing chunk range', { code: 'INVALID_IMAGE', status: 400 });
        const chunk = entry.chunks.get(off)!;
        merged.set(chunk, off);
        cursor += chunk.byteLength;
      }
      if (cursor !== entry.record.totalSize) throw new UploadKitError('Resumable upload is incomplete', { code: 'INVALID_IMAGE', status: 400 });
      return merged;
    },
    claimForCompletion(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.completing) return false;
      entry.completing = true;
      return true;
    },
    releaseCompletion(sessionId) {
      const entry = sessions.get(sessionId);
      if (entry) entry.completing = false;
    },
    delete(sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return;
      totalBufferedBytes = Math.max(0, totalBufferedBytes - entry.bufferedBytes);
      sessions.delete(sessionId);
    },
    listExpired(ts, maxAgeMs) {
      return [...sessions.values()]
        .filter(({ record }) => record.expiresAt <= ts || (maxAgeMs !== undefined && ts - record.createdAt >= maxAgeMs))
        .map(({ record }) => ({ ...record }));
    },
    listAll() {
      return [...sessions.values()].map(({ record }) => ({ ...record }));
    },
  };
}
