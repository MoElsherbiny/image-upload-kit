import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { uploadAsset } from '../src/client';
import {
  createImageUploader,
  createUploadHttpHandler,
  type PresignTokenPayload,
  type PresignTokenStore,
  signUploadToken,
  sweepStagedUploads,
  UploadValidationError,
  verifyUploadToken,
} from '../src/server';
import {
  createMemoryStorageAdapter,
  createS3StorageAdapter,
  createSupabaseStorageAdapter,
} from '../src/storage';

const SECRET = 'test-presign-hmac-secret-key-2026';
let samplePngBuffer: Buffer;

beforeAll(async () => {
  samplePngBuffer = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 16, g: 185, b: 129 } },
  }).png().toBuffer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonRequest(
  action: 'presign' | 'finalize',
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost/api/upload?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('signUploadToken and verifyUploadToken', () => {
  it('signs and verifies valid tokens and rejects tampered, expired, or replayed tokens', async () => {
    const payload: PresignTokenPayload = {
      v: 1, jti: 'test-jti-001', exp: Date.now() + 60_000, bucket: 'media',
      path: '_staging/test-jti-001.png', contentType: 'image/png',
      maxBytes: 5 * 1024 * 1024, preset: 'card', folder: 'cards', originalName: 'hero.png',
    };

    const token = await signUploadToken(payload, SECRET);
    expect(await verifyUploadToken(token, SECRET, { consume: false })).toEqual(payload);

    await expect(signUploadToken(payload, 'short-secret')).rejects.toThrow(
      'Presigned upload token secret must be at least 16 characters',
    );
    await expect(verifyUploadToken(token, 'short-secret')).rejects.toBeInstanceOf(UploadValidationError);
    await expect(verifyUploadToken(token, 'wrong-secret-key-at-least-16-chars')).rejects.toBeInstanceOf(
      UploadValidationError,
    );
    await expect(verifyUploadToken(`${token}x`, SECRET)).rejects.toBeInstanceOf(UploadValidationError);

    const expiredToken = await signUploadToken(
      { ...payload, jti: 'expired-jti', exp: Date.now() - 1000 },
      SECRET,
    );
    await expect(verifyUploadToken(expiredToken, SECRET)).rejects.toThrow('Upload token has expired');

    expect(await verifyUploadToken(token, SECRET)).toEqual(payload);
    await expect(verifyUploadToken(token, SECRET)).rejects.toThrow('Upload token has already been used');
  });
});

describe('createUploadHttpHandler presigned upload flow', () => {
  it('returns 404 when presigned option is not enabled on the handler', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const handler = createUploadHttpHandler({ uploader });

    const res = await handler.POST(
      jsonRequest('presign', { filename: 'photo.png', contentType: 'image/png', size: 1024 }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Presigned uploads are not enabled');
  });

  it('enforces authorize, allowedPresets, and maxSizeMB on ?action=presign', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    const handler = createUploadHttpHandler({
      uploader,
      authorize: ({ request }) => request.headers.get('x-auth') === 'ok',
      allowedPresets: ['avatar'],
      presigned: { secret: SECRET },
    });

    const unauth = await handler.POST(
      jsonRequest('presign', { filename: 'a.png', contentType: 'image/png', size: 1024, preset: 'avatar' }),
    );
    expect(unauth.status).toBe(401);

    const badPreset = await handler.POST(
      jsonRequest('presign', { filename: 'a.png', contentType: 'image/png', size: 1024, preset: 'hero' }, { 'x-auth': 'ok' }),
    );
    expect(badPreset.status).toBe(400);

    const tooLarge = await handler.POST(
      jsonRequest('presign', { filename: 'a.png', contentType: 'image/png', size: 8 * 1024 * 1024, preset: 'avatar' }, { 'x-auth': 'ok' }),
    );
    expect(tooLarge.status).toBe(400);
  });

  it('completes presign -> stage -> finalize, optimizes with Sharp, deletes staged file, and blocks token replay', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    const handler = createUploadHttpHandler({
      uploader,
      presigned: { secret: SECRET, stagingPrefix: '_tmp/' },
    });

    const presignRes = await handler.POST(
      jsonRequest('presign', {
        filename: 'product.png', contentType: 'image/png', size: samplePngBuffer.byteLength, preset: 'card',
      }),
    );
    expect(presignRes.status).toBe(200);
    const presignedData = (await presignRes.json()) as {
      upload: { method: string; url: string }; token: string; bucket: string; path: string;
    };
    expect(presignedData.upload.method).toBe('PUT');
    expect(presignedData.path.startsWith('_tmp/')).toBe(true);

    await storage.putPresigned(presignedData.bucket, presignedData.path, samplePngBuffer, 'image/png');
    expect(storage.getObject(presignedData.bucket, presignedData.path)).toBeDefined();

    const finalizeRes = await handler.POST(
      jsonRequest('finalize', { token: presignedData.token, altText: 'Optimized product card' }),
    );
    expect(finalizeRes.status).toBe(200);
    const uploaded = (await finalizeRes.json()) as {
      url: string; storagePath: string; altText: string; width: number; height: number; blurDataUrl: string;
    };
    expect(uploaded.altText).toBe('Optimized product card');
    expect(uploaded.width).toBe(320);
    expect(uploaded.height).toBe(240);
    expect(uploaded.blurDataUrl.startsWith('data:image/webp;base64,')).toBe(true);

    expect(storage.getObject(presignedData.bucket, presignedData.path)).toBeUndefined();
    expect(storage.getObject('media', uploaded.storagePath)).toBeDefined();

    const replayRes = await handler.POST(jsonRequest('finalize', { token: presignedData.token }));
    expect([400, 409]).toContain(replayRes.status);
  });

  it('rejects spoofed magic bytes or oversized staged objects and cleans up staging', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    const handler = createUploadHttpHandler({ uploader, presigned: { secret: SECRET } });

    const presign1 = await (
      await handler.POST(jsonRequest('presign', { filename: 'fake.png', contentType: 'image/png', size: 32 }))
    ).json();

    await storage.putPresigned(presign1.bucket, presign1.path, Buffer.from('not-an-actual-image'), 'image/png');
    const finalizeSpoofed = await handler.POST(jsonRequest('finalize', { token: presign1.token }));
    expect(finalizeSpoofed.status).toBe(400);
    expect(storage.getObject(presign1.bucket, presign1.path)).toBeUndefined();

    const smallToken = await signUploadToken(
      {
        v: 1, jti: 'oversized-test-jti', exp: Date.now() + 60_000,
        bucket: 'media', path: '_staging/oversized.png', contentType: 'image/png', maxBytes: 100,
      },
      SECRET,
    );
    await storage.putPresigned('media', '_staging/oversized.png', samplePngBuffer, 'image/png');

    const finalizeOversized = await handler.POST(jsonRequest('finalize', { token: smallToken }));
    expect(finalizeOversized.status).toBe(400);
    expect(storage.getObject('media', '_staging/oversized.png')).toBeUndefined();
  });

  it('works end-to-end with client uploadAsset({ mode: "presigned" }) and S3/Supabase adapter helpers', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    const handler = createUploadHttpHandler({ uploader, presigned: { secret: SECRET } });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('memory://presigned/')) {
          const rest = url.slice('memory://presigned/'.length);
          const slashIdx = rest.indexOf('/');
          const blob = init?.body as Blob;
          await storage.putPresigned(
            rest.slice(0, slashIdx), rest.slice(slashIdx + 1),
            new Uint8Array(await blob.arrayBuffer()), 'image/png',
          );
          return new Response(null, { status: 200 });
        }
        return handler.POST(new Request(url, init));
      }),
    );

    const file = new File([new Uint8Array(samplePngBuffer)], 'client.png', { type: 'image/png' });
    const result = await uploadAsset(
      file, { preset: 'thumbnail', altText: 'Client presigned' },
      { mode: 'presigned', endpoint: 'http://localhost/api/upload' },
    );
    expect(result.altText).toBe('Client presigned');
    expect(result.preset).toBe('thumbnail');

    const s3 = createS3StorageAdapter({
      publicBaseUrl: 'https://s3.test',
      putObject: async () => ({}),
      deleteObject: async () => ({}),
      getObject: async () => ({ Body: new Uint8Array([1, 2, 3]) }),
      presignUpload: async ({ bucket, path }) => ({ method: 'PUT', url: `https://s3.test/${bucket}/${path}?sig=1` }),
    });
    expect((await s3.createPresignedUpload!({ bucket: 'b', path: 'k.png', contentType: 'image/png' })).url).toBe(
      'https://s3.test/b/k.png?sig=1',
    );
    expect(Array.from(await s3.download!('b', 'k.png'))).toEqual([1, 2, 3]);

    const supa = createSupabaseStorageAdapter({
      storage: {
        from: () => ({
          upload: async () => ({ data: { path: 'k.png' }, error: null }),
          remove: async () => ({ error: null }),
          getPublicUrl: () => ({ data: { publicUrl: 'https://supa.test/k.png' } }),
          createSignedUploadUrl: async () => ({ data: { signedUrl: 'https://supa.test/signed/k.png' }, error: null }),
          download: async () => ({ data: new Uint8Array([9, 8, 7]), error: null }),
        }),
      },
    });
    expect((await supa.createPresignedUpload!({ bucket: 'b', path: 'k.png', contentType: 'image/png' })).url).toBe(
      'https://supa.test/signed/k.png',
    );
    expect(Array.from(await supa.download!('b', 'k.png'))).toEqual([9, 8, 7]);
    await expect(supa.download!('b', 'k.png', { maxBytes: 2 })).rejects.toThrow('Staged file size exceeds maximum allowed bytes');
    await expect(s3.download!('b', 'k.png', { maxBytes: 2 })).rejects.toThrow('Staged file size exceeds maximum allowed bytes');
  });

  it('atomically blocks concurrent finalize replay, supports custom tokenStore, targetBucket, and sweepStagedUploads', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploader = createImageUploader({ storage, defaultBucket: 'public-media' });
    const consumed = new Set<string>();
    const tokenStore: PresignTokenStore = {
      consume(jti) {
        if (consumed.has(jti)) return false;
        consumed.add(jti);
        return true;
      },
    };
    const handler = createUploadHttpHandler({
      uploader, allowClientBucketOverride: true, allowedBuckets: ['custom-target', 'public-media'],
      presigned: { secret: SECRET, stagingBucket: 'private-staging', stagingPrefix: '_tmp/', tokenStore },
    });

    const presignRes = await handler.POST(
      jsonRequest('presign', {
        filename: 'concurrent.png', contentType: 'image/png',
        size: samplePngBuffer.byteLength, bucket: 'custom-target',
      }),
    );
    expect(presignRes.status).toBe(200);
    const presignedData = (await presignRes.json()) as { token: string; bucket: string; path: string };
    expect(presignedData.bucket).toBe('private-staging');

    await storage.putPresigned(presignedData.bucket, presignedData.path, samplePngBuffer, 'image/png');

    const [res1, res2] = await Promise.all([
      handler.POST(jsonRequest('finalize', { token: presignedData.token })),
      handler.POST(jsonRequest('finalize', { token: presignedData.token })),
    ]);
    expect([res1.status, res2.status].sort((a, b) => a - b)).toEqual([200, 409]);

    const okRes = res1.status === 200 ? res1 : res2;
    const uploaded = (await okRes.json()) as { bucket: string; storagePath: string };
    expect(uploaded.bucket).toBe('custom-target');
    expect(storage.getObject('custom-target', uploaded.storagePath)).toBeDefined();

    await storage.putPresigned('private-staging', '_tmp/abandoned.png', samplePngBuffer, 'image/png');
    const { deleted } = await sweepStagedUploads({
      storage, bucket: 'private-staging', stagingPrefix: '_tmp/',
      maxAgeMs: 60_000, now: Date.now() + 120_000,
    });
    expect(deleted).toBe(1);
    expect(storage.getObject('private-staging', '_tmp/abandoned.png')).toBeUndefined();
  });
});
