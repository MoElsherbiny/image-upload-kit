import { describe, expect, it } from 'vitest';
import {
  abortResumableUpload,
  uploadMultipart,
  uploadResumable,
} from '../../src/client';
import {
  createMemoryResumableSessionStore,
  createMultipartUploadHandler,
  createResumableUploadHandler,
} from '../../src/server/handler';
import { createImageUploader } from '../../src/server/uploadService';
import { createMemoryStorageAdapter } from '../../src/storage/memoryAdapter';

// Valid 1x1 red PNG bytes (68 bytes)
const VALID_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

function createRouteFetch(handlers: {
  POST?: (req: Request) => Promise<Response>;
  PATCH?: (req: Request) => Promise<Response>;
  PUT?: (req: Request) => Promise<Response>;
  DELETE?: (req: Request) => Promise<Response>;
}): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const req = new Request(url, init);
    const method = req.method.toUpperCase() as keyof typeof handlers;
    const handler = handlers[method];
    if (!handler) return new Response('Method Not Allowed', { status: 405 });
    return handler(req);
  };
}

describe('Resumable chunked uploads (server + client)', () => {
  it('completes full lifecycle with interruption, resume, and retryable chunk recovery', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'images' });
    const store = createMemoryResumableSessionStore();
    const handler = createResumableUploadHandler({
      uploader,
      store,
      defaultChunkSize: 20,
      getSubject: ({ request }) => request.headers.get('x-user') ?? undefined,
    });

    const baseFetch = createRouteFetch(handler);
    let patchCalls = 0;
    let savedSessionId = '';
    let lastOffset = 0;

    // First attempt: succeed on chunk 1, then abort during chunk 2
    const abortController = new AbortController();
    const firstFetch: typeof globalThis.fetch = async (input, init) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH') {
        patchCalls++;
        if (patchCalls === 2) {
          abortController.abort();
          const abortErr = new Error('Aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
      }
      return baseFetch(input, init);
    };

    await expect(
      uploadResumable('https://api.test/resumable', VALID_PNG_BYTES, {
        filename: 'pixel.png',
        contentType: 'image/png',
        chunkSize: 20,
        headers: { 'x-user': 'alice' },
        signal: abortController.signal,
        fetch: firstFetch,
        onSessionCreated: (s) => {
          savedSessionId = s.sessionId;
        },
        onProgress: (p) => {
          lastOffset = p.offset;
        },
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });

    expect(savedSessionId).toBeTruthy();
    expect(lastOffset).toBe(20);

    // Resume from savedSessionId & lastOffset, injecting a transient 503 on first resumed chunk
    let injectedTransient = false;
    const resumeFetch: typeof globalThis.fetch = async (input, init) => {
      if ((init?.method ?? 'GET').toUpperCase() === 'PATCH' && !injectedTransient) {
        injectedTransient = true;
        return new Response(
          JSON.stringify({ error: 'Busy', code: 'RESOURCE_LIMIT_EXCEEDED', retryable: true }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        );
      }
      return baseFetch(input, init);
    };

    const uploaded = await uploadResumable('https://api.test/resumable', VALID_PNG_BYTES, {
      filename: 'pixel.png',
      contentType: 'image/png',
      chunkSize: 20,
      sessionId: savedSessionId,
      offset: lastOffset,
      headers: { 'x-user': 'alice' },
      retry: { maxAttempts: 3, baseDelayMs: 1, jitter: false },
      fetch: resumeFetch,
    });

    expect(uploaded.url).toContain('https://memory.local/uploads/images/');
    expect(uploaded.width).toBe(1);
    expect(uploaded.height).toBe(1);
    expect(await store.get(savedSessionId)).toBeNull();
  });

  it('rejects checksum mismatch, cross-user sub access, expired sessions, and supports abort', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'images' });
    const store = createMemoryResumableSessionStore();
    let currentTime = 10_000;
    const handler = createResumableUploadHandler({
      uploader,
      store,
      sessionTtlMs: 5_000,
      now: () => currentTime,
      getSubject: ({ request }) => request.headers.get('x-user') ?? undefined,
    });

    const initRes = await handler.POST(
      new Request('https://api.test/resumable?action=init', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user': 'alice' },
        body: JSON.stringify({
          filename: 'pixel.png',
          contentType: 'image/png',
          totalSize: VALID_PNG_BYTES.byteLength,
          chunkSize: 32,
        }),
      }),
    );
    expect(initRes.status).toBe(201);
    const { sessionId } = (await initRes.json()) as { sessionId: string };

    // 1. Checksum mismatch
    const badHashRes = await handler.PATCH(
      new Request(`https://api.test/resumable?action=chunk&sessionId=${sessionId}&offset=0`, {
        method: 'PATCH',
        headers: { 'x-user': 'alice', 'x-chunk-sha256': '0'.repeat(64) },
        body: VALID_PNG_BYTES.slice(0, 32),
      }),
    );
    expect(badHashRes.status).toBe(400);
    expect((await badHashRes.json()) as { code: string }).toMatchObject({ code: 'INVALID_IMAGE' });

    // 2. Cross-user sub rejection
    const crossUserRes = await handler.PATCH(
      new Request(`https://api.test/resumable?action=chunk&sessionId=${sessionId}&offset=0`, {
        method: 'PATCH',
        headers: { 'x-user': 'bob' },
        body: VALID_PNG_BYTES.slice(0, 32),
      }),
    );
    expect(crossUserRes.status).toBe(403);
    expect((await crossUserRes.json()) as { code: string }).toMatchObject({ code: 'FORBIDDEN' });

    // 3. Expired session rejection
    currentTime += 10_000;
    const expiredRes = await handler.PATCH(
      new Request(`https://api.test/resumable?action=chunk&sessionId=${sessionId}&offset=0`, {
        method: 'PATCH',
        headers: { 'x-user': 'alice' },
        body: VALID_PNG_BYTES.slice(0, 32),
      }),
    );
    expect(expiredRes.status).toBe(410);
    expect((await expiredRes.json()) as { code: string }).toMatchObject({ code: 'UPLOAD_EXPIRED' });

    // 4. Abort cleanup
    const init2 = await handler.POST(
      new Request('https://api.test/resumable?action=init', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user': 'alice' },
        body: JSON.stringify({
          filename: 'pixel.png',
          contentType: 'image/png',
          totalSize: VALID_PNG_BYTES.byteLength,
        }),
      }),
    );
    const { sessionId: session2 } = (await init2.json()) as { sessionId: string };
    await abortResumableUpload('https://api.test/resumable', session2, {
      headers: { 'x-user': 'alice' },
      fetch: createRouteFetch(handler),
    });
    expect(await store.get(session2)).toBeNull();
  });
});

describe('S3-compatible multipart uploads (MemoryStorageAdapter)', () => {
  it('uploads multiple parts concurrently and completes with exact bytes', async () => {
    const storage = createMemoryStorageAdapter();
    const handler = createMultipartUploadHandler({
      storage,
      defaultBucket: 'images',
      getSubject: ({ request }) => request.headers.get('x-user') ?? undefined,
    });

    const payload = new Uint8Array(250);
    for (let i = 0; i < payload.byteLength; i++) payload[i] = i % 251;

    const progressEvents: number[] = [];
    const result = await uploadMultipart('https://api.test/multipart', payload, {
      path: 'photos/large.bin',
      contentType: 'application/octet-stream',
      partSize: 64,
      concurrency: 2,
      headers: { 'x-user': 'alice' },
      fetch: createRouteFetch(handler),
      onProgress: (p) => progressEvents.push(p.percent),
    });

    expect(result.bucket).toBe('images');
    expect(result.path).toBe('photos/large.bin');
    expect(progressEvents.at(-1)).toBe(100);

    const stored = storage.getObject('images', 'photos/large.bin');
    expect(stored).toBeDefined();
    expect(Array.from(stored!.data)).toEqual(Array.from(payload));
  });

  it('aborts multipart upload on failure and enforces subject ownership', async () => {
    const storage = createMemoryStorageAdapter();
    const handler = createMultipartUploadHandler({
      storage,
      defaultBucket: 'images',
      getSubject: ({ request }) => request.headers.get('x-user') ?? undefined,
    });

    const baseFetch = createRouteFetch(handler);
    let aborted = false;
    const failingFetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('action=abort')) aborted = true;
      if (url.includes('partNumber=2')) {
        return new Response(JSON.stringify({ error: 'Rejected', code: 'FORBIDDEN', retryable: false }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
      return baseFetch(input, init);
    };

    const payload = new Uint8Array(150);
    await expect(
      uploadMultipart('https://api.test/multipart', payload, {
        path: 'photos/aborted.bin',
        partSize: 50,
        concurrency: 2,
        headers: { 'x-user': 'alice' },
        retry: { maxAttempts: 2, baseDelayMs: 1, jitter: false },
        fetch: failingFetch,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(aborted).toBe(true);
    expect(storage.getObject('images', 'photos/aborted.bin')).toBeUndefined();

    // Cross-user ownership check on part upload
    const initRes = await handler.POST(
      new Request('https://api.test/multipart?action=init', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user': 'alice' },
        body: JSON.stringify({ path: 'private/doc.bin', contentType: 'application/octet-stream' }),
      }),
    );
    const { uploadId } = (await initRes.json()) as { uploadId: string };
    const bobPart = await handler.PUT(
      new Request(`https://api.test/multipart?action=part&uploadId=${uploadId}&partNumber=1`, {
        method: 'PUT',
        headers: { 'x-user': 'bob' },
        body: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(bobPart.status).toBe(403);
  });
});
