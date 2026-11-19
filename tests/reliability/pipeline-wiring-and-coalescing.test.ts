import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isUploadAbortError,
  uploadAsset,
  uploadViaPresignedUrl,
  uploadViaXhr,
} from '../../src/client';
import {
  createImageUploader,
  createMemoryTransformCache,
  optimizeImage,
} from '../../src/server';
import { createMemoryStorageAdapter, type StorageAdapter } from '../../src/storage';
import { isUploadKitError, UploadKitError } from '../../src/types/errors';

async function makeSplitImage(): Promise<Buffer> {
  const width = 200;
  const height = 100;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      raw[idx] = x < width / 2 ? 240 : 20;
      raw[idx + 1] = 20;
      raw[idx + 2] = x < width / 2 ? 20 : 240;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const makePng = (width = 64, height = 64): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 220 } } })
    .png()
    .toBuffer();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('G-01: createImageUploader preserves UploadKitError & AbortError', () => {
  it('preserves RESOURCE_LIMIT_EXCEEDED, STORAGE_ERROR, FORBIDDEN, and UPLOAD_CANCELLED', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, maxWidth: 50, maxHeight: 50 });

    await expect(
      uploader.uploadImage({ buffer: await makePng(80, 40), name: 'big.png', type: 'image/png' }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        isUploadKitError(err) && err.code === 'RESOURCE_LIMIT_EXCEEDED' && err.status === 400,
    );

    const failingStorage: StorageAdapter = {
      ...storage,
      async upload(): Promise<never> {
        throw new UploadKitError('Upstream S3 unavailable', {
          code: 'STORAGE_ERROR', status: 502, retryable: true,
        });
      },
      async delete(): Promise<never> {
        throw new UploadKitError('Access denied deleting object', {
          code: 'FORBIDDEN', status: 403, retryable: false,
        });
      },
    };
    const failingUploader = createImageUploader({ storage: failingStorage });
    const smallPng = await makePng(24, 24);

    await expect(
      failingUploader.uploadImage({ buffer: smallPng, name: 'ok.png', type: 'image/png' }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        isUploadKitError(err) && err.code === 'STORAGE_ERROR' && err.status === 502 && err.retryable,
    );

    await expect(failingUploader.deleteImage('path/a.avif')).rejects.toSatisfy(
      (err: unknown) => isUploadKitError(err) && err.code === 'FORBIDDEN' && err.status === 403,
    );

    const controller = new AbortController();
    controller.abort();
    await expect(
      uploader.uploadImage(
        { buffer: smallPng, name: 'abort.png', type: 'image/png' },
        { signal: controller.signal },
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        isUploadKitError(err) &&
        err.code === 'UPLOAD_CANCELLED' &&
        err.status === 499 &&
        err.retryable === false,
    );
  });
});

describe('G-05: End-to-end wiring of optimization & security options', () => {
  it('wires focalPoint, colorSpace, preserveMetadata, svgSanitizer, and transformCache end-to-end', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test' });
    const transformCache = createMemoryTransformCache({ maxEntries: 16 });
    const cacheGetSpy = vi.spyOn(transformCache, 'get');
    const cacheSetSpy = vi.spyOn(transformCache, 'set');
    const uploader = createImageUploader({ storage, transformCache, deduplicate: true });

    // 1. focalPoint + distinct dedupe keys per focalPoint
    const split = await makeSplitImage();
    const left = await uploader.uploadImage(
      { buffer: split, name: 'split.png', type: 'image/png' },
      { aspectRatio: '1:1', focalPoint: { x: 0.1, y: 0.5 }, outputFormat: 'png' },
    );
    const right = await uploader.uploadImage(
      { buffer: split, name: 'split.png', type: 'image/png' },
      { aspectRatio: '1:1', focalPoint: { x: 0.9, y: 0.5 }, outputFormat: 'png' },
    );
    expect(right.deduplicated).toBeUndefined();
    const leftStats = await sharp(Buffer.from(storage.getObject('images', left.storagePath!)!.data)).stats();
    const rightStats = await sharp(Buffer.from(storage.getObject('images', right.storagePath!)!.data)).stats();
    expect(leftStats.channels[0].mean).toBeGreaterThan(200);
    expect(rightStats.channels[2].mean).toBeGreaterThan(200);

    // 2. colorSpace: 'srgb'
    const cmykJpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 100, b: 50 } },
    }).toColorspace('cmyk').jpeg().toBuffer();
    const srgbOut = await uploader.uploadImage(
      { buffer: cmykJpeg, name: 'cmyk.jpg', type: 'image/jpeg' },
      { outputFormat: 'jpeg', colorSpace: 'srgb' },
    );
    const srgbMeta = await sharp(Buffer.from(storage.getObject('images', srgbOut.storagePath!)!.data)).metadata();
    expect(srgbMeta.space).toBe('srgb');

    // 3. preserveMetadata
    const jpegWithExif = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 90, g: 90, b: 90 } },
    }).jpeg({ quality: 10 }).withExif({ IFD0: { Make: 'TestCam' } }).toBuffer();
    const stripped = await uploader.uploadImage(
      { buffer: jpegWithExif, name: 'exif.jpg', type: 'image/jpeg' },
      { preserveMetadata: false },
    );
    const kept = await uploader.uploadImage(
      { buffer: jpegWithExif, name: 'exif.jpg', type: 'image/jpeg' },
      { preserveMetadata: true },
    );
    expect(kept.deduplicated).toBeUndefined();
    expect((await sharp(Buffer.from(storage.getObject('images', stripped.storagePath!)!.data)).metadata()).exif).toBeUndefined();
    expect((await sharp(Buffer.from(storage.getObject('images', kept.storagePath!)!.data)).metadata()).exif).toBeDefined();

    // 4. svgSanitizer custom hook
    const svgSanitizer = vi.fn((svg: string) => svg.replace('#000000', '#10B981'));
    const rawSvg = Buffer.from(
      '<svg viewBox="0 0 80 40" xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="80" height="40" fill="#000000"/></svg>',
      'utf8',
    );
    const svgOut = await uploader.uploadImage(
      { buffer: rawSvg, name: 'icon.svg', type: 'image/svg+xml' },
      { allowSvg: true, svgSanitizer, deduplicate: false },
    );
    expect(svgSanitizer).toHaveBeenCalledTimes(1);
    const storedSvg = Buffer.from(storage.getObject('images', svgOut.storagePath!)!.data).toString('utf8');
    expect(storedSvg).toContain('#10B981');
    expect(storedSvg).not.toContain('<script');

    // 5. transformCache hit on repeated optimization (dedupe disabled)
    cacheGetSpy.mockClear();
    cacheSetSpy.mockClear();
    const sample = await makePng(48, 48);
    await uploader.uploadImage({ buffer: sample, name: 'c1.png', type: 'image/png' }, { outputFormat: 'webp', deduplicate: false });
    await uploader.uploadImage({ buffer: sample, name: 'c2.png', type: 'image/png' }, { outputFormat: 'webp', deduplicate: false });
    expect(cacheSetSpy).toHaveBeenCalledTimes(1);
    expect(cacheGetSpy).toHaveBeenCalledTimes(2);
  });

  it('sanitizes malicious SVG before Sharp runs in optimizeImage', async () => {
    const customSanitizer = vi.fn((svg: string) => svg.replace('fill="red"', 'fill="green"'));
    const malicious = Buffer.from(
      '<!DOCTYPE svg [<!ENTITY xxe "pwn">]><svg viewBox="0 0 100 50" onload="alert(1)"><script>evil()</script><foreignObject><div>x</div></foreignObject><rect width="100" height="50" fill="red"/></svg>',
      'utf8',
    );
    const result = await optimizeImage(malicious, { customSanitizer, maxWidth: 200 });
    expect(result.format).toBe('svg');
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
    expect(customSanitizer).toHaveBeenCalledTimes(1);
    const text = result.buffer.toString('utf8');
    expect(text).toContain('fill="green"');
    expect(text).not.toMatch(/<script|onload|foreignObject|<!DOCTYPE|<!ENTITY/i);

    await expect(optimizeImage(Buffer.from('<svg><rect><unclosed></svg>', 'utf8'))).rejects.toSatisfy(
      (err: unknown) => isUploadKitError(err) && err.code === 'INVALID_IMAGE',
    );
  });
});

describe('G-07: In-flight deduplication coalescing', () => {
  it('coalesces concurrent identical uploads into one storage.upload and cleans up on failure', async () => {
    const base = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test' });
    let failNext = false;
    let uploadCalls = 0;
    const storage: StorageAdapter = {
      ...base,
      async upload(params) {
        uploadCalls += 1;
        await new Promise((r) => setTimeout(r, 25));
        if (failNext) {
          throw new UploadKitError('Transient failure', {
            code: 'STORAGE_ERROR', status: 502, retryable: true,
          });
        }
        return base.upload(params);
      },
    };
    const uploader = createImageUploader({ storage, deduplicate: true });
    const buf = await makePng(40, 40);

    const [first, second, third] = await Promise.all([
      uploader.uploadImage({ buffer: buf, name: 'a.png', type: 'image/png' }, { altText: 'A' }),
      uploader.uploadImage({ buffer: buf, name: 'b.png', type: 'image/png' }, { altText: 'B' }),
      uploader.uploadImage({ buffer: buf, name: 'c.png', type: 'image/png' }, { altText: 'C' }),
    ]);
    const all = [first, second, third];
    expect(uploadCalls).toBe(1);
    expect(all.filter((r) => r.deduplicated === undefined)).toHaveLength(1);
    expect(all.filter((r) => r.deduplicated === true)).toHaveLength(2);
    expect(second.url).toBe(first.url);
    expect(third.url).toBe(first.url);
    expect(first.altText).toBe('A');
    expect(second.altText).toBe('B');
    expect(third.altText).toBe('C');

    const buf2 = await makePng(44, 44);
    failNext = true;
    await expect(
      uploader.uploadImage({ buffer: buf2, name: 'fail.png', type: 'image/png' }),
    ).rejects.toSatisfy((err: unknown) => isUploadKitError(err) && err.code === 'STORAGE_ERROR');

    failNext = false;
    const recovered = await uploader.uploadImage({ buffer: buf2, name: 'retry.png', type: 'image/png' });
    expect(recovered.deduplicated).toBeUndefined();
    expect(recovered.url).toContain('https://cdn.test');
  });
});

describe('G-06 (Client): Structured UploadKitError & uploadAsset retry', () => {
  it('throws UploadKitError with code/retryable from xhrUpload/presignedUpload and retries transient errors', async () => {
    const file = new File(['abc'], 'photo.png', { type: 'image/png' });
    const okPayload = {
      url: 'https://cdn.test/ok.avif', blurDataUrl: 'data:image/webp;base64,AA',
      blurColor: '#112233', width: 100, height: 100, format: 'avif', size: 120,
      contentHash: 'hash1', uploadedAt: '2026-11-19T00:00:00.000Z',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid token', code: 'UNAUTHORIZED', retryable: false }), { status: 401 }),
    );
    await expect(uploadViaXhr('/api/upload', new FormData())).rejects.toSatisfy(
      (err: unknown) =>
        isUploadKitError(err) && err.code === 'UNAUTHORIZED' && !err.retryable && err.message.includes('status 401'),
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Slow down', code: 'RATE_LIMITED', retryable: true }), { status: 429 }),
    );
    await expect(uploadViaPresignedUrl('/api/upload', file)).rejects.toSatisfy(
      (err: unknown) => isUploadKitError(err) && err.code === 'RATE_LIMITED' && err.retryable,
    );

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('socket hang up'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Busy', code: 'RESOURCE_LIMIT_EXCEEDED', retryable: true }), { status: 503 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(okPayload), { status: 200 }));

    const res = await uploadAsset(
      file,
      { preset: 'card' },
      { endpoint: '/api/upload', retry: { maxAttempts: 3, baseDelayMs: 1, jitter: false } },
    );
    expect(res.url).toBe('https://cdn.test/ok.avif');
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const ac = new AbortController();
    ac.abort();
    await expect(uploadAsset(file, {}, { signal: ac.signal, retry: true })).rejects.toSatisfy(
      (err: unknown) => isUploadAbortError(err) && isUploadKitError(err) && err.code === 'UPLOAD_CANCELLED',
    );
  });
});
