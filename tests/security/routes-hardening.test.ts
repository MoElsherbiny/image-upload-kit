import { describe, expect, it, vi } from 'vitest';
import {
  createImageUploader,
  createMemoryMultipartSessionStore,
  createMemoryRateLimiter,
  createMemoryResumableSessionStore,
  createMultipartUploadHandler,
  createResumableUploadHandler,
  createUploadHttpHandler,
  readBoundedStreamBytes,
} from '../../src/server';
import { createMemoryStorageAdapter } from '../../src/storage/memoryAdapter';
import { isUploadKitError } from '../../src/types/errors';

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function jsonPost(url: string, body: unknown, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function makeTrackedStream(chunks: Uint8Array[]) {
  let cancelled = false;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, isCancelled: () => cancelled };
}

function streamRequest(url: string, method: string, stream: ReadableStream<Uint8Array>, headers?: HeadersInit): Request {
  return new Request(url, {
    method,
    headers,
    body: stream,
    // @ts-expect-error Node fetch duplex option for ReadableStream request bodies
    duplex: 'half',
  });
}

describe('Streaming byte-capped reader & route enforcement', () => {
  it('cancels stream and returns 413 FILE_TOO_LARGE when body exceeds limit without Content-Length', async () => {
    const { stream, isCancelled } = makeTrackedStream([new Uint8Array(60), new Uint8Array(60), new Uint8Array(60)]);
    const res = await readBoundedStreamBytes(streamRequest('https://api.test/up', 'POST', stream), 100);
    expect(res.bytes).toBeUndefined();
    expect(res.errorResponse?.status).toBe(413);
    expect(await res.errorResponse!.json()).toMatchObject({ error: expect.any(String), code: 'FILE_TOO_LARGE', retryable: false });
    expect(isCancelled()).toBe(true);
  });

  it('cancels oversized streamed chunk in resumableRoute and part in multipartRoute with 413', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'images' });

    const resumable = createResumableUploadHandler({ uploader, maxChunkSize: 40 });
    const initRes = await resumable.POST(jsonPost('https://api.test/r?action=init', { filename: 'p.png', contentType: 'image/png', totalSize: 100 }));
    const { sessionId } = (await initRes.json()) as { sessionId: string };
    const rStream = makeTrackedStream([new Uint8Array(25), new Uint8Array(25), new Uint8Array(25)]);
    const chunkRes = await resumable.PATCH(streamRequest(`https://api.test/r?action=chunk&sessionId=${sessionId}&offset=0`, 'PATCH', rStream.stream));
    expect(chunkRes.status).toBe(413);
    expect(await chunkRes.json()).toMatchObject({ code: 'FILE_TOO_LARGE', retryable: false });
    expect(rStream.isCancelled()).toBe(true);

    const multipart = createMultipartUploadHandler({ storage, maxPartBytes: 40 });
    const mInit = await multipart.POST(jsonPost('https://api.test/m?action=init', { path: 'a.png', contentType: 'image/png' }));
    const { uploadId } = (await mInit.json()) as { uploadId: string };
    const mStream = makeTrackedStream([new Uint8Array(25), new Uint8Array(25), new Uint8Array(25)]);
    const partRes = await multipart.PUT(streamRequest(`https://api.test/m?action=part&uploadId=${uploadId}&partNumber=1`, 'PUT', mStream.stream));
    expect(partRes.status).toBe(413);
    expect(await partRes.json()).toMatchObject({ code: 'FILE_TOO_LARGE', retryable: false });
    expect(mStream.isCancelled()).toBe(true);
  });
});

describe('Resumable route hardening', () => {
  it('enforces maxSessions, maxTotalBytes, and prunes expired sessions in memory store', () => {
    let clock = 10_000;
    const store = createMemoryResumableSessionStore({ maxSessions: 2, maxTotalBytes: 100, now: () => clock });
    const makeRec = (id: string, totalSize: number, ttl = 5_000) => ({
      id, filename: 'a.png', contentType: 'image/png', totalSize, chunkSize: 50,
      receivedBytes: 0, createdAt: clock, expiresAt: clock + ttl,
    });

    store.create(makeRec('s1', 40));
    store.create(makeRec('s2', 40));
    try {
      store.create(makeRec('s3', 10));
      expect.unreachable('Expected maxSessions rejection');
    } catch (err) {
      expect(isUploadKitError(err) && err.code === 'RESOURCE_LIMIT_EXCEEDED' && err.status === 503).toBe(true);
    }

    store.appendChunk('s1', 0, new Uint8Array(40));
    store.appendChunk('s2', 0, new Uint8Array(40));
    try {
      store.appendChunk('s2', 40, new Uint8Array(30));
      expect.unreachable('Expected maxTotalBytes rejection');
    } catch (err) {
      expect(isUploadKitError(err) && err.code === 'RESOURCE_LIMIT_EXCEEDED' && err.status === 503).toBe(true);
    }

    clock += 6_000;
    expect(() => store.create(makeRec('s3', 90))).not.toThrow();
    expect(store.get('s1')).toBeNull();
  });

  it('ignores client folder unless allowClientOverrides.folder is enabled and enforces rateLimiter', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'images' });

    const runUpload = async (allowClientOverrides?: { folder?: boolean | ((f: string) => string | null) }, folder = 'injected/path') => {
      const handler = createResumableUploadHandler({ uploader, allowClientOverrides });
      const init = await handler.POST(jsonPost('https://api.test/r?action=init', { filename: 'p.png', contentType: 'image/png', totalSize: PNG_1X1.byteLength, folder }));
      if (init.status !== 201) return { status: init.status, body: await init.json() };
      const { sessionId } = (await init.json()) as { sessionId: string };
      await handler.PATCH(new Request(`https://api.test/r?action=chunk&sessionId=${sessionId}&offset=0`, { method: 'PATCH', body: PNG_1X1 }));
      const done = await handler.POST(new Request(`https://api.test/r?action=complete&sessionId=${sessionId}`, { method: 'POST' }));
      return { status: done.status, body: (await done.json()) as { storagePath?: string } };
    };

    const ignored = await runUpload(undefined, 'injected/path');
    expect(ignored.status).toBe(200);
    expect((ignored.body as { storagePath?: string }).storagePath).not.toContain('injected');

    const allowed = await runUpload({ folder: true }, 'custom/folder');
    expect(allowed.status).toBe(200);
    expect((allowed.body as { storagePath?: string }).storagePath).toContain('custom/folder/');

    const rejected = await runUpload({ folder: (f) => (f.startsWith('u1/') ? f : null) }, 'admin/secret');
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ code: 'INVALID_IMAGE', retryable: false });

    const rlHandler = createResumableUploadHandler({
      uploader,
      rateLimiter: createMemoryRateLimiter({ limit: 1, windowMs: 60_000 }),
    });
    expect((await rlHandler.POST(jsonPost('https://api.test/r?action=init', { filename: 'a.png', contentType: 'image/png', totalSize: 10 }))).status).toBe(201);
    const limited = await rlHandler.POST(jsonPost('https://api.test/r?action=init', { filename: 'b.png', contentType: 'image/png', totalSize: 10 }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
  });

  it('rejects concurrent double-complete with 409 INVALID_UPLOAD_TOKEN without duplicate upload', async () => {
    const baseStorage = createMemoryStorageAdapter();
    const uploadSpy = vi.fn(async (params: Parameters<typeof baseStorage.upload>[0]) => {
      await new Promise((r) => setTimeout(r, 25));
      return baseStorage.upload(params);
    });
    const uploader = createImageUploader({ storage: { ...baseStorage, upload: uploadSpy }, defaultBucket: 'images' });
    const handler = createResumableUploadHandler({ uploader });

    const init = await handler.POST(jsonPost('https://api.test/r?action=init', { filename: 'race.png', contentType: 'image/png', totalSize: PNG_1X1.byteLength }));
    const { sessionId } = (await init.json()) as { sessionId: string };
    await handler.PATCH(new Request(`https://api.test/r?action=chunk&sessionId=${sessionId}&offset=0`, { method: 'PATCH', body: PNG_1X1 }));

    const [r1, r2] = await Promise.all([
      handler.POST(new Request(`https://api.test/r?action=complete&sessionId=${sessionId}`, { method: 'POST' })),
      handler.POST(new Request(`https://api.test/r?action=complete&sessionId=${sessionId}`, { method: 'POST' })),
    ]);

    expect([r1.status, r2.status].sort((a, b) => a - b)).toEqual([200, 409]);
    const conflict = r1.status === 409 ? r1 : r2;
    expect(await conflict.json()).toMatchObject({ code: 'INVALID_UPLOAD_TOKEN', retryable: false });
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Multipart route hardening', () => {
  it('rejects disallowed MIME types, enforces store TTL/caps, path override=false, maxTotalBytes, and rateLimiter', async () => {
    let clock = 50_000;
    const storage = createMemoryStorageAdapter();
    const store = createMemoryMultipartSessionStore({ maxSessions: 1, ttlMs: 1_000, now: () => clock });
    const handler = createMultipartUploadHandler({
      storage,
      store,
      now: () => clock,
      maxTotalBytes: 20,
      allowClientPathOverride: false,
      rateLimiter: createMemoryRateLimiter({ limit: 5, windowMs: 60_000, now: () => clock }),
    });

    const badMime = await handler.POST(jsonPost('https://api.test/m?action=init', { path: 'evil.html', contentType: 'text/html' }));
    expect(badMime.status).toBe(400);
    expect(await badMime.json()).toMatchObject({ code: 'UNSUPPORTED_FORMAT', retryable: false });

    const okInit = await handler.POST(jsonPost('https://api.test/m?action=init', { path: 'attacker/overwrite.png', folder: 'safe', contentType: 'image/png' }));
    expect(okInit.status).toBe(200);
    const created = (await okInit.json()) as { uploadId: string; path: string };
    expect(created.path).toMatch(/^safe\/[0-9a-f-]+\.png$/);

    const capRes = await handler.POST(jsonPost('https://api.test/m?action=init', { contentType: 'image/png' }));
    expect(capRes.status).toBe(503);
    expect(await capRes.json()).toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED', retryable: true });

    const p1 = await handler.PUT(new Request(`https://api.test/m?action=part&uploadId=${created.uploadId}&partNumber=1`, { method: 'PUT', body: new Uint8Array(15) }));
    expect(p1.status).toBe(200);
    const p2 = await handler.PUT(new Request(`https://api.test/m?action=part&uploadId=${created.uploadId}&partNumber=2`, { method: 'PUT', body: new Uint8Array(10) }));
    expect(p2.status).toBe(413);
    expect(await p2.json()).toMatchObject({ code: 'FILE_TOO_LARGE', retryable: false });

    const limited = await handler.POST(jsonPost('https://api.test/m?action=init', { contentType: 'image/png' }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'RATE_LIMITED', retryable: true });

    clock += 2_000;
    expect(await store.get(created.uploadId)).toBeNull();
  });
});

describe('Unified structured HTTP errors across guards and routes', () => {
  it('emits { error, code, retryable } for 401, 403, 413, parseUploadForm, delete, presign, and finalize', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    const handler = createUploadHttpHandler({
      uploader,
      allowedOrigins: ['https://app.test'],
      authorize: ({ request }) => request.headers.get('x-auth') === 'ok',
      maxBodyBytes: 64,
    });

    const badOrigin = await handler.POST(new Request('https://api.test/up', { method: 'POST', headers: { origin: 'https://evil.test' } }));
    expect(badOrigin.status).toBe(403);
    expect(await badOrigin.json()).toEqual({ error: 'Forbidden origin', code: 'FORBIDDEN', retryable: false });

    const tooLarge = await handler.POST(new Request('https://api.test/up', { method: 'POST', headers: { origin: 'https://app.test', 'content-length': '512' }, body: 'x' }));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: expect.any(String), code: 'FILE_TOO_LARGE', retryable: false });

    const unauth = await handler.POST(new Request('https://api.test/up', { method: 'POST', headers: { origin: 'https://app.test' } }));
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED', retryable: false });

    const noFile = await handler.POST(new Request('https://api.test/up', { method: 'POST', headers: { origin: 'https://app.test', 'x-auth': 'ok' }, body: new FormData() }));
    expect(noFile.status).toBe(400);
    expect(await noFile.json()).toEqual({ error: 'No file provided', code: 'INVALID_IMAGE', retryable: false });

    const delMissing = await handler.DELETE(new Request('https://api.test/up', { method: 'DELETE', headers: { origin: 'https://app.test', 'x-auth': 'ok' } }));
    expect(delMissing.status).toBe(400);
    expect(await delMissing.json()).toMatchObject({ error: expect.any(String), code: 'INVALID_IMAGE', retryable: false });

    const delForbidden = await handler.DELETE(new Request('https://api.test/up?path=a.png&bucket=other', { method: 'DELETE', headers: { origin: 'https://app.test', 'x-auth': 'ok' } }));
    expect(delForbidden.status).toBe(403);
    expect(await delForbidden.json()).toMatchObject({ error: expect.any(String), code: 'FORBIDDEN', retryable: false });

    const presignOff = await handler.POST(new Request('https://api.test/up?action=presign', { method: 'POST' }));
    expect(presignOff.status).toBe(404);
    expect(await presignOff.json()).toMatchObject({ error: expect.any(String), code: 'FORBIDDEN', retryable: false });

    const presignHandler = createUploadHttpHandler({ uploader, presigned: { secret: 'structured-error-test-secret-key-2026' } });
    const badJson = await presignHandler.POST(new Request('https://api.test/up?action=presign', { method: 'POST', body: '{not-json' }));
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toMatchObject({ code: 'INVALID_IMAGE', retryable: false });

    const noToken = await presignHandler.POST(jsonPost('https://api.test/up?action=finalize', {}));
    expect(noToken.status).toBe(400);
    expect(await noToken.json()).toMatchObject({ code: 'INVALID_UPLOAD_TOKEN', retryable: false });
  });
});
