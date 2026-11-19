import { describe, expect, it, vi } from 'vitest';
import { defineUploadPresets } from '../../src';
import {
  createImageUploader,
  createMemoryRateLimiter,
  createMemoryResumableSessionStore,
  createMultipartUploadHandler,
  createResumableUploadHandler,
  createUploadHttpHandler,
  type PresignTokenStore,
} from '../../src/server';
import { createMemoryStorageAdapter } from '../../src/storage/memoryAdapter';
import type { StorageAdapter } from '../../src/storage/types';
import { UploadKitError } from '../../src/types/errors';

const VALID_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function jsonPost(url: string, body: unknown, headers?: Record<string, string>): Request {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

function pngFormRequest(url: string, headers?: Record<string, string>): Request {
  const form = new FormData();
  form.set('file', new File([VALID_PNG], 'pixel.png', { type: 'image/png' }));
  return new Request(url, { method: 'POST', headers, body: form });
}

describe('Re-audit H-1, H-2 & L-7: Multipart secure defaults, magic-byte validation, and part accounting', () => {
  it('ignores client path by default (H-1) and rejects application/octet-stream (H-2)', async () => {
    const storage = createMemoryStorageAdapter();
    const handler = createMultipartUploadHandler({ storage, defaultBucket: 'images' });

    const octetRes = await handler.POST(jsonPost('https://api.test/mp?action=init', { path: 'x.bin', contentType: 'application/octet-stream' }));
    expect(octetRes.status).toBe(400);
    expect(await octetRes.json()).toMatchObject({ code: 'UNSUPPORTED_FORMAT', retryable: false });

    const victimInit = await handler.POST(
      jsonPost('https://api.test/mp?action=init', { path: 'avatars/victim-user/profile.png', folder: 'avatars', contentType: 'image/png' }),
    );
    expect(victimInit.status).toBe(200);
    const created = (await victimInit.json()) as { uploadId: string; path: string };
    expect(created.path).not.toBe('avatars/victim-user/profile.png');
    expect(created.path).toMatch(/^avatars\/[0-9a-f-]+\.png$/);
  });

  it('deletes non-image multipart objects on complete with 400 INVALID_IMAGE and enforces adapter download check (H-2)', async () => {
    const storage = createMemoryStorageAdapter();
    const handler = createMultipartUploadHandler({ storage, defaultBucket: 'images' });

    const init = await handler.POST(jsonPost('https://api.test/mp?action=init', { contentType: 'image/png' }));
    const { uploadId, path } = (await init.json()) as { uploadId: string; path: string };

    const evilHtml = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
    const partRes = await handler.PUT(new Request(`https://api.test/mp?action=part&uploadId=${uploadId}&partNumber=1`, { method: 'PUT', body: evilHtml }));
    const { etag } = (await partRes.json()) as { etag: string };

    const completeRes = await handler.POST(jsonPost('https://api.test/mp?action=complete', { uploadId, parts: [{ partNumber: 1, etag }] }));
    expect(completeRes.status).toBe(400);
    expect(await completeRes.json()).toMatchObject({ code: 'INVALID_IMAGE', retryable: false });
    expect(storage.getObject('images', path)).toBeUndefined();

    const noDownloadStorage: StorageAdapter = {
      upload: storage.upload, delete: storage.delete,
      createMultipartUpload: storage.createMultipartUpload, uploadPart: storage.uploadPart,
      completeMultipartUpload: storage.completeMultipartUpload, abortMultipartUpload: storage.abortMultipartUpload,
    };
    const noDlRes = await createMultipartUploadHandler({ storage: noDownloadStorage }).POST(
      jsonPost('https://api.test/mp?action=init', { contentType: 'image/png' }),
    );
    expect(noDlRes.status).toBe(501);
    const noDlBody = (await noDlRes.json()) as { error: string; code: string };
    expect(noDlBody.code).toBe('STORAGE_ERROR');
    expect(noDlBody.error).toContain('validateOnComplete: false');

    const optOutInit = await createMultipartUploadHandler({ storage: noDownloadStorage, validateOnComplete: false }).POST(
      jsonPost('https://api.test/mp?action=init', { contentType: 'image/png' }),
    );
    expect(optOutInit.status).toBe(200);
  });

  it('replaces byte count when re-uploading the same partNumber instead of double-counting (L-7)', async () => {
    const storage = createMemoryStorageAdapter();
    const handler = createMultipartUploadHandler({ storage, maxTotalBytes: 100 });

    const init = await handler.POST(jsonPost('https://api.test/mp?action=init', { contentType: 'image/png' }));
    const { uploadId } = (await init.json()) as { uploadId: string };

    expect((await handler.PUT(new Request(`https://api.test/mp?action=part&uploadId=${uploadId}&partNumber=1`, { method: 'PUT', body: new Uint8Array(70) }))).status).toBe(200);
    // Re-uploading part 1 with 68-byte PNG replaces 70 -> total 68 (<= 100), not 138
    expect((await handler.PUT(new Request(`https://api.test/mp?action=part&uploadId=${uploadId}&partNumber=1`, { method: 'PUT', body: VALID_PNG }))).status).toBe(200);
    // Part 2 exceeding remaining (100 - 68 = 32 bytes) is rejected with 413
    expect((await handler.PUT(new Request(`https://api.test/mp?action=part&uploadId=${uploadId}&partNumber=2`, { method: 'PUT', body: new Uint8Array(40) }))).status).toBe(413);
  });
});

describe('Re-audit H-3: Resumable preset bucket resolution', () => {
  it('stores and authorizes the preset bucket instead of falling back to defaultBucket', async () => {
    const storage = createMemoryStorageAdapter();
    const presets = defineUploadPresets({ privateDoc: { bucket: 'private-bucket', folder: 'docs', maxSizeMB: 5 } });
    const uploader = createImageUploader({ storage, defaultBucket: 'images', presets });
    const seenBuckets: Array<string | undefined> = [];

    const handler = createResumableUploadHandler({
      uploader,
      authorize: ({ bucket }) => {
        seenBuckets.push(bucket);
        return true;
      },
    });

    const init = await handler.POST(
      jsonPost('https://api.test/res?action=init', { filename: 'id.png', contentType: 'image/png', totalSize: VALID_PNG.byteLength, preset: 'privateDoc' }),
    );
    expect(init.status).toBe(201);
    const { sessionId } = (await init.json()) as { sessionId: string };
    expect(seenBuckets[0]).toBe('private-bucket');

    await handler.PATCH(new Request(`https://api.test/res?action=chunk&sessionId=${sessionId}&offset=0`, { method: 'PATCH', body: VALID_PNG }));
    const complete = await handler.POST(new Request(`https://api.test/res?action=complete&sessionId=${sessionId}`, { method: 'POST' }));
    expect(complete.status).toBe(200);
    const uploaded = (await complete.json()) as { bucket: string; storagePath: string };
    expect(uploaded.bucket).toBe('private-bucket');
    expect(storage.getObject('private-bucket', uploaded.storagePath)).toBeDefined();
    expect((await storage.list('images', '')).items).toHaveLength(0);
  });
});

describe('Re-audit M-1: Rate limiter trustProxy header hardening', () => {
  it('ignores spoofed X-Forwarded-For / X-Real-IP / CF-Connecting-IP when trustProxy is false (default)', async () => {
    const uploader = createImageUploader({ storage: createMemoryStorageAdapter() });
    const handler = createUploadHttpHandler({ uploader, rateLimiter: createMemoryRateLimiter({ limit: 1, windowMs: 60_000 }) });

    const statuses: number[] = [];
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      const res = await handler.POST(pngFormRequest('https://api.test/upload', { 'x-forwarded-for': ip, 'x-real-ip': ip, 'cf-connecting-ip': ip }));
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 429, 429]);
  });

  it('uses the Nth X-Forwarded-For entry from the right when trustProxy is enabled', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const hop1 = createUploadHttpHandler({ uploader, trustProxy: 1, rateLimiter: createMemoryRateLimiter({ limit: 1, windowMs: 60_000 }) });

    const r1 = await hop1.POST(pngFormRequest('https://api.test/up', { 'x-forwarded-for': '10.0.0.1, 203.0.113.9' }));
    const r2 = await hop1.POST(pngFormRequest('https://api.test/up', { 'x-forwarded-for': '10.0.0.2, 203.0.113.9' }));
    const r3 = await hop1.POST(pngFormRequest('https://api.test/up', { 'x-forwarded-for': '10.0.0.2, 203.0.113.10' }));
    expect([r1.status, r2.status, r3.status]).toEqual([200, 429, 200]);

    const hop2 = createMultipartUploadHandler({ storage, trustProxy: 2, rateLimiter: createMemoryRateLimiter({ limit: 1, windowMs: 60_000 }) });
    const m1 = await hop2.POST(jsonPost('https://api.test/m?action=init', { contentType: 'image/png' }, { 'x-forwarded-for': '1.1.1.1, 198.51.100.7, 10.0.0.5' }));
    const m2 = await hop2.POST(jsonPost('https://api.test/m?action=init', { contentType: 'image/png' }, { 'x-forwarded-for': '9.9.9.9, 198.51.100.7, 10.0.0.6' }));
    expect([m1.status, m2.status]).toEqual([200, 429]);
  });
});

describe('Re-audit M-6 & L-2: Retry-safe completion/finalize and cleanup error reporting', () => {
  it('preserves resumable session on retryable uploadImage error and deletes on non-retryable error (M-6)', async () => {
    const storage = createMemoryStorageAdapter();
    const baseUploader = createImageUploader({ storage });
    let mode: 'retryable' | 'ok' | 'fatal' = 'retryable';
    const uploader = {
      ...baseUploader,
      uploadImage: vi.fn(async (...args: Parameters<typeof baseUploader.uploadImage>) => {
        if (mode === 'retryable') throw new UploadKitError('S3 503 SlowDown', { code: 'STORAGE_ERROR', status: 503, retryable: true });
        if (mode === 'fatal') throw new UploadKitError('Corrupt image', { code: 'INVALID_IMAGE', status: 400, retryable: false });
        return baseUploader.uploadImage(...args);
      }),
    };
    const store = createMemoryResumableSessionStore();
    const handler = createResumableUploadHandler({ uploader, store });

    const init = await handler.POST(jsonPost('https://api.test/r?action=init', { filename: 'a.png', contentType: 'image/png', totalSize: VALID_PNG.byteLength }));
    const { sessionId } = (await init.json()) as { sessionId: string };
    await handler.PATCH(new Request(`https://api.test/r?action=chunk&sessionId=${sessionId}&offset=0`, { method: 'PATCH', body: VALID_PNG }));

    const fail1 = await handler.POST(new Request(`https://api.test/r?action=complete&sessionId=${sessionId}`, { method: 'POST' }));
    expect(fail1.status).toBe(503);
    expect(await fail1.json()).toMatchObject({ code: 'STORAGE_ERROR', retryable: true });
    expect(await store.get(sessionId)).not.toBeNull();

    mode = 'ok';
    const retryOk = await handler.POST(new Request(`https://api.test/r?action=complete&sessionId=${sessionId}`, { method: 'POST' }));
    expect(retryOk.status).toBe(200);
    expect(await store.get(sessionId)).toBeNull();

    mode = 'fatal';
    const init2 = await handler.POST(jsonPost('https://api.test/r?action=init', { filename: 'b.png', contentType: 'image/png', totalSize: VALID_PNG.byteLength }));
    const { sessionId: s2 } = (await init2.json()) as { sessionId: string };
    await handler2ChunkAndComplete(handler, s2);
    expect(await store.get(s2)).toBeNull();

    async function handler2ChunkAndComplete(h: typeof handler, id: string) {
      await h.PATCH(new Request(`https://api.test/r?action=chunk&sessionId=${id}&offset=0`, { method: 'PATCH', body: VALID_PNG }));
      expect((await h.POST(new Request(`https://api.test/r?action=complete&sessionId=${id}`, { method: 'POST' }))).status).toBe(400);
    }
  });

  it('releases presign jti & preserves staged object on retryable finalize error, deletes on non-retryable, and reports cleanup errors via onError (M-6, L-2)', async () => {
    const storage = createMemoryStorageAdapter();
    const baseUploader = createImageUploader({ storage, defaultBucket: 'images' });
    let mode: 'retryable' | 'fatal' | 'ok' = 'retryable';
    let failDelete = false;
    const deleteErr = new Error('Staging bucket delete failed');
    const wrappedStorage: StorageAdapter = {
      ...storage,
      delete: async (b, p) => {
        if (failDelete) throw deleteErr;
        return storage.delete(b, p);
      },
    };
    const uploader = {
      ...baseUploader,
      storage: wrappedStorage,
      getStorage: () => wrappedStorage,
      uploadImage: vi.fn(async (...args: Parameters<typeof baseUploader.uploadImage>) => {
        if (mode === 'retryable') throw new UploadKitError('Transient S3 outage', { code: 'STORAGE_ERROR', status: 503, retryable: true });
        if (mode === 'fatal') throw new UploadKitError('Corrupt payload', { code: 'INVALID_IMAGE', status: 400, retryable: false });
        return baseUploader.uploadImage(...args);
      }),
    };

    const consumed = new Set<string>();
    const releaseSpy = vi.fn((jti: string) => {
      consumed.delete(jti);
    });
    const tokenStore: PresignTokenStore = {
      consume: (jti) => (consumed.has(jti) ? false : (consumed.add(jti), true)),
      release: releaseSpy,
    };
    const onError = vi.fn();
    const handler = createUploadHttpHandler({
      uploader,
      onError,
      presigned: { secret: 'reaudit-test-presign-secret-key-2026', stagingBucket: 'staging', tokenStore },
    });

    const presignRes = await handler.POST(jsonPost('https://api.test/up?action=presign', { filename: 'p.png', contentType: 'image/png', size: VALID_PNG.byteLength }));
    const { token, path: stagedPath } = (await presignRes.json()) as { token: string; path: string };
    await storage.upload({ bucket: 'staging', path: stagedPath, data: VALID_PNG, contentType: 'image/png' });

    // Attempt 1: retryable 503 -> jti released, staged object preserved
    expect((await handler.POST(jsonPost('https://api.test/up?action=finalize', { token }))).status).toBe(503);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(storage.getObject('staging', stagedPath)).toBeDefined();

    // Attempt 2: uploadImage succeeds, staged cleanup delete fails -> 200 returned AND onError invoked (L-2)
    mode = 'ok';
    failDelete = true;
    onError.mockClear();
    expect((await handler.POST(jsonPost('https://api.test/up?action=finalize', { token }))).status).toBe(200);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(deleteErr, expect.objectContaining({ action: 'upload' }));

    // Non-retryable failure deletes staged object & keeps jti consumed (also exercise default in-memory token store)
    failDelete = false;
    mode = 'fatal';
    const memHandler = createUploadHttpHandler({
      uploader,
      presigned: { secret: 'reaudit-test-presign-secret-key-2026', stagingBucket: 'staging' },
    });
    const presign2 = await memHandler.POST(jsonPost('https://api.test/up?action=presign', { filename: 'q.png', contentType: 'image/png', size: VALID_PNG.byteLength }));
    const { token: token2, path: path2 } = (await presign2.json()) as { token: string; path: string };
    await storage.upload({ bucket: 'staging', path: path2, data: VALID_PNG, contentType: 'image/png' });
    expect((await memHandler.POST(jsonPost('https://api.test/up?action=finalize', { token: token2 }))).status).toBe(400);
    expect(storage.getObject('staging', path2)).toBeUndefined();
    expect((await memHandler.POST(jsonPost('https://api.test/up?action=finalize', { token: token2 }))).status).toBe(409);
  });
});
