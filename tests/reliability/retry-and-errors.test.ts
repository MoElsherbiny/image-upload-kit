import { describe, expect, it, vi } from 'vitest';
import {
  computeRetryDelayMs,
  createCancelledUploadError,
  createNetworkUploadError,
  parseClientUploadError,
  withRetry,
} from '../../src/client';
import { createMemoryResumableSessionStore } from '../../src/server/handler';
import {
  cleanupAbandonedResumableSessions,
  cleanupExpiredStagingObjects,
} from '../../src/server/uploadService';
import { createMemoryStorageAdapter } from '../../src/storage/memoryAdapter';
import { UploadKitError } from '../../src/types/errors';

describe('Client structured errors (parseClientUploadError)', () => {
  it('preserves server code, retryable, and metadata when present', () => {
    const raw = JSON.stringify({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      retryable: true,
      metadata: { retryAfterSeconds: 12 },
    });
    const err = parseClientUploadError(429, raw);
    expect(err).toBeInstanceOf(UploadKitError);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.metadata).toEqual({ retryAfterSeconds: 12 });
    expect(err.message).toBe('Too many requests');
  });

  it('maps HTTP status codes deterministically when server omits structured fields', () => {
    const cases: Array<[number, string, boolean]> = [
      [401, 'UNAUTHORIZED', false],
      [403, 'FORBIDDEN', false],
      [413, 'FILE_TOO_LARGE', false],
      [429, 'RATE_LIMITED', true],
      [503, 'RESOURCE_LIMIT_EXCEEDED', true],
      [500, 'STORAGE_ERROR', true],
      [502, 'STORAGE_ERROR', true],
      [400, 'INVALID_IMAGE', false],
      [422, 'INVALID_IMAGE', false],
    ];

    for (const [status, expectedCode, expectedRetryable] of cases) {
      const err = parseClientUploadError(status, 'not-json', 'Fallback');
      expect(err.code).toBe(expectedCode);
      expect(err.status).toBe(status);
      expect(err.retryable).toBe(expectedRetryable);
      expect(err.message).toBe('Fallback');
    }
  });

  it('builds network and cancelled upload errors with expected codes and retryability', () => {
    const cause = new Error('ECONNRESET');
    const netErr = createNetworkUploadError('Connection dropped', cause);
    expect(netErr.code).toBe('STORAGE_ERROR');
    expect(netErr.retryable).toBe(true);
    expect(netErr.cause).toBe(cause);

    const cancelErr = createCancelledUploadError('User cancelled');
    expect(cancelErr.code).toBe('UPLOAD_CANCELLED');
    expect(cancelErr.retryable).toBe(false);
    expect(cancelErr.status).toBe(499);
  });
});

describe('Exponential backoff + jitter retry (withRetry)', () => {
  it('computes exponential backoff with and without jitter', () => {
    expect(computeRetryDelayMs(1, 100, 1000, false)).toBe(100);
    expect(computeRetryDelayMs(2, 100, 1000, false)).toBe(200);
    expect(computeRetryDelayMs(3, 100, 1000, false)).toBe(400);
    expect(computeRetryDelayMs(5, 100, 1000, false)).toBe(1000);

    const jittered = computeRetryDelayMs(2, 200, 1000, true);
    expect(jittered).toBeGreaterThanOrEqual(200);
    expect(jittered).toBeLessThanOrEqual(400);
  });

  it('retries transient 429, 503, and network errors until success', async () => {
    const errors = [
      parseClientUploadError(429, ''),
      parseClientUploadError(503, ''),
      createNetworkUploadError(),
    ];
    let calls = 0;
    const onRetry = vi.fn();

    const result = await withRetry(
      async () => {
        const current = calls++;
        if (current < errors.length) throw errors[current];
        return 'ok';
      },
      { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 5, jitter: false, onRetry },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(4);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('never retries non-retryable 400/401/403/413/422 or cancelled/AbortError', async () => {
    const abortErr = new Error('Aborted');
    abortErr.name = 'AbortError';

    const nonRetryables = [
      parseClientUploadError(400, ''),
      parseClientUploadError(401, ''),
      parseClientUploadError(403, ''),
      parseClientUploadError(413, ''),
      parseClientUploadError(422, ''),
      createCancelledUploadError(),
      abortErr,
    ];

    for (const err of nonRetryables) {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls++;
            throw err;
          },
          { maxAttempts: 3, baseDelayMs: 1, jitter: false },
        ),
      ).rejects.toThrow();
      expect(calls).toBe(1);
    }
  });

  it('aborts retry backoff wait immediately when AbortSignal fires', async () => {
    const controller = new AbortController();
    let calls = 0;
    const start = Date.now();

    const promise = withRetry(
      async () => {
        calls++;
        throw createNetworkUploadError();
      },
      {
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 10_000,
        jitter: false,
        signal: controller.signal,
        onRetry: () => {
          setTimeout(() => controller.abort(), 15);
        },
      },
    );

    await expect(promise).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });
    expect(calls).toBe(1);
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});

describe('Safe orphan & resumable session cleanup', () => {
  it('refuses to run without explicit stagingPrefix or positive maxAgeMs', async () => {
    const storage = createMemoryStorageAdapter();
    await expect(
      cleanupExpiredStagingObjects({
        storage,
        bucket: 'images',
        stagingPrefix: '   ',
        maxAgeMs: 1000,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });

    await expect(
      cleanupExpiredStagingObjects({
        storage,
        bucket: 'images',
        stagingPrefix: '_staging/',
        maxAgeMs: 0,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('supports dryRun vs delete for expired staging objects while preserving live objects', async () => {
    const storage = createMemoryStorageAdapter();
    await storage.upload({
      bucket: 'images',
      path: '_staging/old.png',
      data: new Uint8Array([1, 2]),
      contentType: 'image/png',
    });
    await storage.upload({
      bucket: 'images',
      path: 'live/keep.png',
      data: new Uint8Array([3, 4]),
      contentType: 'image/png',
    });

    const futureNow = Date.now() + 120_000;
    const dryResult = await cleanupExpiredStagingObjects({
      storage,
      bucket: 'images',
      stagingPrefix: '_staging/',
      maxAgeMs: 60_000,
      dryRun: true,
      now: futureNow,
    });
    expect(dryResult.expired).toBe(1);
    expect(dryResult.deleted).toBe(0);
    expect(dryResult.paths).toEqual(['_staging/old.png']);
    expect(await storage.exists('images', '_staging/old.png')).toBe(true);

    const realResult = await cleanupExpiredStagingObjects({
      storage,
      bucket: 'images',
      stagingPrefix: '_staging/',
      maxAgeMs: 60_000,
      dryRun: false,
      now: futureNow,
    });
    expect(realResult.expired).toBe(1);
    expect(realResult.deleted).toBe(1);
    expect(await storage.exists('images', '_staging/old.png')).toBe(false);
    expect(await storage.exists('images', 'live/keep.png')).toBe(true);
  });

  it('sweeps abandoned resumable sessions with dryRun and delete modes', async () => {
    const store = createMemoryResumableSessionStore();
    const baseNow = 1_000_000;
    await store.create({
      id: 'old-session',
      filename: 'a.png',
      contentType: 'image/png',
      totalSize: 100,
      chunkSize: 50,
      receivedBytes: 0,
      createdAt: baseNow,
      expiresAt: baseNow + 10_000,
    });
    await store.create({
      id: 'fresh-session',
      filename: 'b.png',
      contentType: 'image/png',
      totalSize: 100,
      chunkSize: 50,
      receivedBytes: 0,
      createdAt: baseNow + 50_000,
      expiresAt: baseNow + 120_000,
    });

    const dry = await cleanupAbandonedResumableSessions(store, {
      maxAgeMs: 30_000,
      dryRun: true,
      now: baseNow + 60_000,
    });
    expect(dry.expired).toBe(1);
    expect(dry.deleted).toBe(0);
    expect(dry.sessionIds).toEqual(['old-session']);
    expect(await store.get('old-session')).not.toBeNull();

    const real = await cleanupAbandonedResumableSessions(store, {
      maxAgeMs: 30_000,
      dryRun: false,
      now: baseNow + 60_000,
    });
    expect(real.deleted).toBe(1);
    expect(await store.get('old-session')).toBeNull();
    expect(await store.get('fresh-session')).not.toBeNull();
  });
});
