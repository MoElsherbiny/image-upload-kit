import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadAsset, uploadMultipart, uploadResumable } from '../../src/client';
import { createMemoryStorageAdapter, migrateStorage } from '../../src/storage';
import { toFile } from '../helpers/imageFixtures';
import { type LiveTestServer, startLiveTestServer } from '../helpers/liveTestServer';

async function gradientImage(width: number, height: number, format: 'png' | 'jpeg'): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      raw[idx] = Math.round((x / width) * 240);
      raw[idx + 1] = Math.round((y / height) * 200);
      raw[idx + 2] = 140;
    }
  }
  const img = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === 'png' ? img.png({ compressionLevel: 1 }).toBuffer() : img.jpeg({ quality: 92 }).toBuffer();
}

async function focalLandscapeJpeg(width = 1200, height = 800): Promise<Buffer> {
  const focalPatch = await sharp({
    create: { width: 360, height: 360, channels: 3, background: '#f04422' },
  }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: '#102458' } })
    .composite([{ input: focalPatch, left: 60, top: 60 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('E2E Upload & Storage Modes over Live Node HTTP Server', { timeout: 20_000 }, () => {
  let server: LiveTestServer;
  let pngBuffer: Buffer;

  beforeAll(async () => {
    pngBuffer = await gradientImage(240, 160, 'png');
    server = await startLiveTestServer({
      uploaderOptions: { focalPoint: { x: 0.2, y: 0.3 }, deduplicate: { enabled: true } },
      resumableChunkSize: 1024,
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  it('retries direct upload automatically after transient 503 STORAGE_ERROR and writes AVIF to disk', async () => {
    let attempts = 0;
    server.setInterceptor((req, url) => {
      if (req.method === 'POST' && url.pathname === '/api/upload' && ++attempts === 1) {
        return { status: 503, body: { error: 'Transient storage outage', code: 'STORAGE_ERROR', retryable: true } };
      }
      return null;
    });

    try {
      const file = toFile(pngBuffer, 'retry-direct.png', 'image/png');
      const result = await uploadAsset(
        file,
        { preset: 'card', altText: 'Retried direct image', customFilename: 'retry-hero' },
        { endpoint: server.uploadUrl, retry: { maxAttempts: 3, baseDelayMs: 10 } },
      );

      expect(attempts).toBe(2);
      expect([result.format, result.width, result.height, result.altText]).toEqual([
        'avif', 240, 160, 'Retried direct image',
      ]);
      expect(result.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
      expect(await server.localFs.exists('media', result.storagePath!)).toBe(true);

      const diskBytes = Buffer.from(await server.localFs.download('media', result.storagePath!));
      const meta = await sharp(diskBytes).metadata();
      expect([meta.width, meta.height]).toEqual([240, 160]);
    } finally {
      server.setInterceptor(null);
    }
  });

  it('executes two-phase presigned upload (presign -> HTTP PUT -> finalize) with getSubject auth and deletes staged file', async () => {
    const wireSteps: string[] = [];
    let stagedPath = '';

    server.setInterceptor((req, url) => {
      if (url.pathname === '/api/upload' && url.searchParams.get('action') === 'presign') {
        wireSteps.push(`POST:presign:${req.headers['x-user-id'] ?? ''}`);
      } else if (req.method === 'PUT' && url.pathname.startsWith('/__storage_put/')) {
        const rest = url.pathname.slice('/__storage_put/'.length);
        stagedPath = decodeURIComponent(rest.slice(rest.indexOf('/') + 1));
        wireSteps.push('PUT:storage');
      } else if (url.pathname === '/api/upload' && url.searchParams.get('action') === 'finalize') {
        wireSteps.push(`POST:finalize:${req.headers['x-user-id'] ?? ''}`);
      }
      return null;
    });

    try {
      const uploaded = await uploadAsset(
        toFile(pngBuffer, 'presigned-photo.png', 'image/png'),
        { preset: 'cover', altText: 'Presigned E2E Asset' },
        { endpoint: server.uploadUrl, mode: 'presigned', headers: { 'x-user-id': 'alice-subject' } },
      );

      expect(wireSteps).toEqual(['POST:presign:alice-subject', 'PUT:storage', 'POST:finalize:alice-subject']);
      expect(stagedPath).toMatch(/^_staging\//);
      expect(await server.localFs.exists('media', stagedPath)).toBe(false);
      expect([uploaded.format, uploaded.altText]).toEqual(['avif', 'Presigned E2E Asset']);
      expect(await server.localFs.exists('media', uploaded.storagePath!)).toBe(true);

      const presignRes = await fetch(`${server.uploadUrl}?action=presign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': 'alice-subject' },
        body: JSON.stringify({ filename: 'sub.png', contentType: 'image/png', size: pngBuffer.byteLength }),
      });
      const presigned = (await presignRes.json()) as {
        upload: { url: string; headers?: Record<string, string> };
        token: string;
        path: string;
      };
      await fetch(presigned.upload.url, {
        method: 'PUT', headers: presigned.upload.headers, body: new Uint8Array(pngBuffer),
      });

      const bobAttempt = await fetch(`${server.uploadUrl}?action=finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': 'bob-intruder' },
        body: JSON.stringify({ token: presigned.token }),
      });
      expect(bobAttempt.status).toBe(403);
      expect(await server.localFs.exists('media', presigned.path)).toBe(true);

      const aliceFinalize = await fetch(`${server.uploadUrl}?action=finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': 'alice-subject' },
        body: JSON.stringify({ token: presigned.token }),
      });
      expect(aliceFinalize.status).toBe(200);
      expect(await server.localFs.exists('media', presigned.path)).toBe(false);
    } finally {
      server.setInterceptor(null);
    }
  });

  it('completes resumable chunked upload across mid-stream interruption, server offset recovery, and SHA-256 verification', async () => {
    const chunkBytes = new Uint8Array(await gradientImage(220, 150, 'png'));
    expect(chunkBytes.byteLength).toBeGreaterThan(2048);

    const seenShaHeaders: string[] = [];
    let sessionId = '';
    let interruptedOnce = false;

    server.setInterceptor((req, url) => {
      if (req.method === 'PATCH' && url.pathname === '/api/resumable') {
        const sha = req.headers['x-chunk-sha256'];
        if (typeof sha === 'string') seenShaHeaders.push(sha);
        if (Number(url.searchParams.get('offset') ?? '0') >= 1024 && !interruptedOnce) {
          interruptedOnce = true;
          return { status: 503, body: { error: 'Connection dropped on chunk 2', code: 'STORAGE_ERROR', retryable: true } };
        }
      }
      return null;
    });

    try {
      await expect(
        uploadResumable(server.resumableUrl, chunkBytes, {
          filename: 'interrupted.png', contentType: 'image/png', chunkSize: 1024, preset: 'card',
          headers: { 'x-user-id': 'resumable-user' }, retry: { maxAttempts: 1, baseDelayMs: 5 },
          onSessionCreated: (info) => { sessionId = info.sessionId; },
        }),
      ).rejects.toMatchObject({ code: 'STORAGE_ERROR' });

      const serverSession = await server.resumableStore.get(sessionId);
      expect(serverSession?.receivedBytes).toBe(1024);

      const completed = await uploadResumable(server.resumableUrl, chunkBytes, {
        filename: 'interrupted.png', contentType: 'image/png', chunkSize: 1024,
        sessionId, offset: serverSession!.receivedBytes,
        headers: { 'x-user-id': 'resumable-user' }, retry: { maxAttempts: 2, baseDelayMs: 10 },
      });

      expect(seenShaHeaders.length).toBeGreaterThanOrEqual(3);
      expect(seenShaHeaders.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
      expect([completed.format, completed.width, completed.height]).toEqual(['avif', 220, 150]);
      expect(await server.localFs.exists('media', completed.storagePath!)).toBe(true);
      expect(await server.resumableStore.get(sessionId)).toBeNull();
    } finally {
      server.setInterceptor(null);
    }
  });

  it('completes valid multipart upload with server-generated key and rejects spoofed HTML on validateOnComplete', async () => {
    const uploaded = await uploadMultipart(server.multipartUrl, new Uint8Array(pngBuffer), {
      path: 'client-chosen/evil-name.png', contentType: 'image/png',
      partSize: 1500, concurrency: 2, headers: { 'x-user-id': 'mp-user' },
    });

    expect(uploaded.bucket).toBe('media');
    expect(uploaded.path).not.toContain('client-chosen');
    expect(uploaded.path).toMatch(/^[0-9a-f-]+\.png$/);
    expect(await server.multipartStorage.exists('media', uploaded.path)).toBe(true);

    const countBeforeSpoof = server.multipartStorage.size;
    const spoofedHtml = new Uint8Array(Buffer.from('<!doctype html><script>alert("xss")</script>', 'utf8'));

    await expect(
      uploadMultipart(server.multipartUrl, spoofedHtml, {
        path: 'spoofed.png', contentType: 'image/png', partSize: 32, headers: { 'x-user-id': 'mp-user' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE', status: 400 });

    expect(server.multipartStorage.size).toBe(countBeforeSpoof);
  });

  it('handles square 1:1 focal-point crop, responsive variants + srcSet, deduplication, and migrateStorage', async () => {
    const landscapeJpeg = await focalLandscapeJpeg(1200, 800);
    const first = await uploadAsset(
      toFile(landscapeJpeg, 'catalog-1.jpg', 'image/jpeg'),
      { preset: 'square', altText: 'Focal square product' },
      { endpoint: server.uploadUrl },
    );

    expect([first.width, first.height, first.deduplicated]).toEqual([800, 800, undefined]);
    expect(first.variants?.map((v) => `${v.width}x${v.height}`)).toEqual(['400x400']);
    expect(first.srcSet).toContain('400w');
    expect(first.srcSet).toContain('800w');

    const croppedBytes = Buffer.from(await server.localFs.download('media', first.storagePath!));
    const topLeftPixel = await sharp(croppedBytes).extract({ left: 100, top: 100, width: 1, height: 1 }).raw().toBuffer();
    expect(topLeftPixel[0]).toBeGreaterThan(150);

    const second = await uploadAsset(
      toFile(landscapeJpeg, 'catalog-duplicate.jpg', 'image/jpeg'),
      { preset: 'square', altText: 'Duplicate upload' },
      { endpoint: server.uploadUrl },
    );
    expect([second.deduplicated, second.url, second.contentHash]).toEqual([true, first.url, first.contentHash]);

    const squareFolder = path.posix.dirname(first.storagePath!);
    const memoryTarget = createMemoryStorageAdapter();
    const dryReport = await migrateStorage({
      source: server.localFs, target: memoryTarget, sourceBucket: 'media', folder: squareFolder, dryRun: true,
    });
    expect([dryReport.dryRun, dryReport.copied, memoryTarget.size]).toEqual([true, 0, 0]);
    expect(dryReport.skipped).toBeGreaterThanOrEqual(2);

    const liveReport = await migrateStorage({
      source: server.localFs, target: memoryTarget, sourceBucket: 'media', folder: squareFolder, verifyIntegrity: true,
    });
    expect(liveReport.copied).toBeGreaterThanOrEqual(2);
    expect(liveReport.failed).toBe(0);
    expect(await memoryTarget.exists('media', first.storagePath!)).toBe(true);
  });
});
