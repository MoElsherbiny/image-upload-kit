import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { defineUploadPresets } from '../src';
import {
  createImageUploader,
  createUploadHttpHandler,
  encodeBlurHashString,
  extractEnhancedColorFromBuffer,
  generateBlurPlaceholder,
  isCollisionError,
  optimizeImage,
} from '../src/server';
import {
  createLocalFsStorageAdapter,
  createMemoryStorageAdapter,
} from '../src/storage';

async function makeImg(
  fmt: 'jpeg' | 'png' | 'webp' | 'avif',
  w = 80,
  h = 80,
  q = 80,
): Promise<Buffer> {
  const s = sharp({
    create: { width: w, height: h, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 0.9 } },
  });
  if (fmt === 'jpeg') return s.jpeg({ quality: q }).toBuffer();
  if (fmt === 'png') return s.png().toBuffer();
  if (fmt === 'webp') return s.webp({ quality: q }).toBuffer();
  return s.avif({ quality: q }).toBuffer();
}

describe('Raster Image Processing & Presets', () => {
  it('optimizes and uploads JPEG, PNG, WebP, and AVIF with correct metadata', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'photos' });

    for (const fmt of ['jpeg', 'png', 'webp', 'avif'] as const) {
      const buf = await makeImg(fmt, 120, 90);
      const res = await uploader.uploadImage(
        { buffer: buf, name: `sample.${fmt}`, type: `image/${fmt}` },
        { outputFormat: fmt },
      );
      expect(res.format).toBe(fmt);
      expect(res.width).toBe(120);
      expect(res.height).toBe(90);
      expect(res.blurDataUrl.startsWith('data:image/webp;base64,')).toBe(true);
      expect(res.blurColor).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('downscales oversized raster images according to preset dimensions', async () => {
    const storage = createMemoryStorageAdapter();
    const presets = defineUploadPresets({
      avatarThumb: { maxDimensions: { width: 60, height: 60 }, outputFormat: 'webp' },
    });
    const uploader = createImageUploader({ storage, presets });
    const largeJpeg = await makeImg('jpeg', 300, 150);

    const res = await uploader.uploadImage(
      { buffer: largeJpeg, type: 'image/jpeg' },
      { preset: 'avatarThumb' },
    );
    expect(res.width).toBe(60);
    expect(res.height).toBe(30);
    expect(res.format).toBe('webp');
  });
});

describe('Size-Guard Fallback & Quality Control', () => {
  it('triggers size-guard fallback when AVIF expands tiny JPEG', async () => {
    const tinyJpeg = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 90, g: 90, b: 90 } },
    }).jpeg({ quality: 15 }).toBuffer();

    const optimized = await optimizeImage(tinyJpeg, { maxDimensions: { width: 400, height: 400 } });
    expect(optimized.format).toBe('jpeg');
    expect(optimized.size).toBeLessThanOrEqual(tinyJpeg.length);
  });

  it('bypasses size-guard when outputFormat is explicitly requested as avif', async () => {
    const tinyJpeg = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 90, g: 90, b: 90 } },
    }).jpeg({ quality: 15 }).toBuffer();

    const res = await optimizeImage(tinyJpeg, { outputFormat: 'avif' });
    expect(res.format).toBe('avif');
  });
});

describe('EXIF, Transparency, Blur & Collision Hardening', () => {
  it('auto-rotates images with EXIF orientation metadata', async () => {
    const testBuffer = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const optimized = await optimizeImage(testBuffer, { outputFormat: 'jpeg' });
    expect(optimized.width).toBe(20);
    expect(optimized.height).toBe(40);
  });

  it('ignores transparent pixels and extracts dominant color from visible content', async () => {
    const pngBuffer = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
    }).composite([{
      input: await sharp({
        create: { width: 6, height: 6, channels: 4, background: { r: 0, g: 100, b: 220, alpha: 1 } },
      }).png().toBuffer(),
      top: 7,
      left: 7,
    }]).png().toBuffer();

    const color = await extractEnhancedColorFromBuffer(pngBuffer);
    expect(color).not.toBe('#FFFFFF');
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('detects SVGs containing large XML/DOCTYPE prolog (> 120 bytes)', async () => {
    const prolog = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      '<!-- Generated with custom headers to exceed 120 bytes limit -->\n';
    const svgContent = prolog + '<SVG viewBox="0 0 100 100"><rect width="100" height="100" fill="#10B981"/></SVG>';
    const result = await generateBlurPlaceholder(Buffer.from(svgContent, 'utf8'));
    expect(result.dataURL.startsWith('data:image/webp;base64,')).toBe(true);
  });

  it('clamps BlurHash components for extreme aspect ratios and out-of-bounds parameters', async () => {
    const skinnyBuffer = await sharp({
      create: { width: 1, height: 32, channels: 3, background: { r: 200, g: 50, b: 50 } },
    }).png().toBuffer();

    const hash = await encodeBlurHashString(skinnyBuffer, 8, 3);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('distinguishes collision errors from missing bucket/directory errors', () => {
    expect(isCollisionError(new Error('File already exists at /path'))).toBe(true);
    expect(isCollisionError(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }))).toBe(true);
    expect(isCollisionError(new Error('Bucket does not exist'))).toBe(false);
    expect(isCollisionError(new Error("Directory doesn't exist"))).toBe(false);
    expect(isCollisionError(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))).toBe(false);
  });
});

describe('HTTP Handler Validation Error Mapping', () => {
  it('returns HTTP 400 Bad Request for client validation errors', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({
      storage,
      defaultMaxSizeMB: 0.005,
      defaultAllowedFormats: ['image/png', 'image/webp'],
      presets: defineUploadPresets({ avatar: { folder: 'avatars' } }),
    });
    const handler = createUploadHttpHandler({ uploader, allowedPresets: ['avatar'] });
    const post = (body: FormData) =>
      handler.POST(new Request('http://localhost/api/upload', { method: 'POST', body }));

    // 1. Missing file -> 400
    expect((await post(new FormData())).status).toBe(400);

    // 2. Disallowed preset -> 400
    const formBadPreset = new FormData();
    formBadPreset.append('file', new File([new Uint8Array(await makeImg('png', 30, 30))], 'a.png', { type: 'image/png' }));
    formBadPreset.append('preset', 'forbidden');
    expect((await post(formBadPreset)).status).toBe(400);

    // 3. Oversized file -> 400
    const formOversized = new FormData();
    formOversized.append('file', new File([new Uint8Array(8192)], 'big.png', { type: 'image/png' }));
    const overRes = await post(formOversized);
    expect(overRes.status).toBe(400);
    expect(((await overRes.json()) as { error: string }).error).toContain('exceeds maximum');

    // 4. Disallowed MIME format -> 400
    const formBadFmt = new FormData();
    formBadFmt.append('file', new File([new Uint8Array(await makeImg('jpeg', 30, 30))], 'pic.jpg', { type: 'image/jpeg' }));
    const badFmtRes = await post(formBadFmt);
    expect(badFmtRes.status).toBe(400);
    expect(((await badFmtRes.json()) as { error: string }).error).toContain('not allowed');

    // 5. DELETE route missing query -> 400
    const delMissing = await handler.DELETE(new Request('http://localhost/api/upload', { method: 'DELETE' }));
    expect(delMissing.status).toBe(400);

    // 6. DELETE route unknown URL -> 400
    const delUnknown = await handler.DELETE(
      new Request('http://localhost/api/upload?url=https://unknown.com/x.png', { method: 'DELETE' }),
    );
    expect(delUnknown.status).toBe(400);

    // 7. Unexpected internal error -> 500
    const brokenStorage = {
      ...storage,
      async upload(): Promise<never> { throw new Error('Database disk I/O failure'); },
    };
    const brokenHandler = createUploadHttpHandler({
      uploader: createImageUploader({ storage: brokenStorage }),
    });
    const formOk = new FormData();
    formOk.append('file', new File([new Uint8Array(await makeImg('png', 30, 30))], 'ok.png', { type: 'image/png' }));
    const err500Res = await brokenHandler.POST(
      new Request('http://localhost/api/upload', { method: 'POST', body: formOk }),
    );
    expect(err500Res.status).toBe(500);
  });
});

describe('Storage Adapter Parity & deleteByUrl', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('MemoryAdapter: defaults to upsert: true and deletes by URL', async () => {
    const memory = createMemoryStorageAdapter({ baseUrl: 'https://mem.cdn/up' });

    const up1 = await memory.upload({ bucket: 'cat', path: 'item.webp', data: Buffer.from('v1'), contentType: 'image/webp' });
    const up2 = await memory.upload({ bucket: 'cat', path: 'item.webp', data: Buffer.from('v2'), contentType: 'image/webp' });
    expect(up2.url).toBe(up1.url);
    expect(memory.getObject('cat', 'item.webp')?.data).toEqual(new Uint8Array(Buffer.from('v2')));

    await expect(
      memory.upload({ bucket: 'cat', path: 'item.webp', data: Buffer.from('v3'), contentType: 'image/webp', upsert: false }),
    ).rejects.toThrow('Object already exists');

    expect(await memory.deleteByUrl(up1.url)).toBe(true);
    expect(await memory.deleteByUrl(up1.url)).toBe(false);
    expect(await memory.deleteByUrl('https://other.host/file.webp')).toBe(false);
  });

  it('LocalFsAdapter: defaults to upsert: true, blocks traversal, and deletes by URL', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-fs-'));
    tempDirs.push(tempRoot);

    const localFs = createLocalFsStorageAdapter({ rootDir: tempRoot, baseUrl: '/static/uploads' });

    const up1 = await localFs.upload({ bucket: 'cat', path: 'asset.png', data: Buffer.from('v1'), contentType: 'image/png' });
    await localFs.upload({ bucket: 'cat', path: 'asset.png', data: Buffer.from('v2'), contentType: 'image/png' });
    const diskContent = await fs.readFile(path.join(tempRoot, 'cat', 'asset.png'));
    expect(diskContent.toString()).toBe('v2');

    await expect(
      localFs.upload({ bucket: 'cat', path: 'asset.png', data: Buffer.from('v3'), contentType: 'image/png', upsert: false }),
    ).rejects.toThrow('File already exists');

    expect(await localFs.deleteByUrl(up1.url)).toBe(true);
    await expect(fs.access(path.join(tempRoot, 'cat', 'asset.png'))).rejects.toThrow();
    expect(await localFs.deleteByUrl(up1.url)).toBe(false);
    expect(await localFs.deleteByUrl('/static/uploads/../../etc/passwd')).toBe(false);
    expect(await localFs.deleteByUrl('https://evil.org/static/uploads/cat/asset.png')).toBe(false);
  });

  it('uploader delegates deleteByUrl to underlying adapter identically', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-upld-'));
    tempDirs.push(tempRoot);

    const localFs = createLocalFsStorageAdapter({ rootDir: tempRoot });
    const uploader = createImageUploader({ storage: localFs, defaultBucket: 'test' });

    const buf = await makeImg('png', 40, 40);
    const uploaded = await uploader.uploadImage({ buffer: buf, type: 'image/png' });

    expect(await uploader.deleteByUrl(uploaded.url)).toBe(true);
    expect(await uploader.deleteByUrl(uploaded.url)).toBe(false);
  });
});
