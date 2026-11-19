import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  buildResizePlan,
  buildTransformCacheKey,
  createMemoryTransformCache,
  negotiateOutputFormat,
  optimizeImage,
} from '../src/server';
import { isUploadKitError } from '../src/types/errors';

async function makeTwoToneImage(): Promise<Buffer> {
  // 200x100 image: left half bright red, right half bright blue
  const width = 200;
  const height = 100;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      if (x < width / 2) {
        raw[idx] = 240;
        raw[idx + 1] = 20;
        raw[idx + 2] = 20;
      } else {
        raw[idx] = 20;
        raw[idx + 1] = 20;
        raw[idx + 2] = 240;
      }
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe('Image Optimization Engine Hardening & Features', () => {
  it('strips EXIF metadata on JPEG passthrough unless preserveMetadata is explicitly true (R-03)', async () => {
    const tinyJpegWithExif = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .jpeg({ quality: 10 })
      .withExif({ IFD0: { Make: 'SecretCamera', Model: 'GPS-Tracker' } })
      .toBuffer();

    const beforeMeta = await sharp(tinyJpegWithExif).metadata();
    expect(beforeMeta.exif).toBeDefined();

    // Default behavior: EXIF MUST be stripped even in passthrough fallback
    const stripped = await optimizeImage(tinyJpegWithExif, {
      maxDimensions: { width: 400, height: 400 },
    });
    const strippedMeta = await sharp(stripped.buffer).metadata();
    expect(strippedMeta.exif).toBeUndefined();

    // Explicit preserveMetadata: true retains EXIF
    const preserved = await optimizeImage(tinyJpegWithExif, {
      maxDimensions: { width: 400, height: 400 },
      preserveMetadata: true,
    });
    const preservedMeta = await sharp(preserved.buffer).metadata();
    expect(preservedMeta.exif).toBeDefined();
  });

  it('supports focalPoint cropping in buildResizePlan and optimizeImage', async () => {
    const planLeft = buildResizePlan({
      width: 200,
      height: 100,
      maxDimensions: { width: 100, height: 100 },
      aspectRatio: '1:1',
      focalPoint: { x: 0.0, y: 0.5 },
    });
    expect(planLeft.fit).toBe('cover');
    if (planLeft.fit === 'cover') {
      expect(planLeft.extract).toEqual({ left: 0, top: 0, width: 100, height: 100 });
    }

    const twoTone = await makeTwoToneImage();
    const leftCrop = await optimizeImage(twoTone, {
      aspectRatio: '1:1',
      focalPoint: { x: 0.1, y: 0.5 },
      outputFormat: 'png',
    });
    const rightCrop = await optimizeImage(twoTone, {
      aspectRatio: '1:1',
      focalPoint: { x: 0.9, y: 0.5 },
      outputFormat: 'png',
    });

    const leftStats = await sharp(leftCrop.buffer).stats();
    const rightStats = await sharp(rightCrop.buffer).stats();
    expect(leftStats.channels[0].mean).toBeGreaterThan(200); // red dominant
    expect(rightStats.channels[2].mean).toBeGreaterThan(200); // blue dominant
  });

  it('enforces maxWidth, maxHeight, and maxFrames limits before encoding', async () => {
    const img = await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    await expect(optimizeImage(img, { maxWidth: 100 })).rejects.toSatisfy((err: unknown) => {
      return isUploadKitError(err) && err.code === 'INVALID_IMAGE' && err.status === 400;
    });

    await expect(optimizeImage(img, { maxHeight: 50 })).rejects.toSatisfy((err: unknown) => {
      return isUploadKitError(err) && err.code === 'INVALID_IMAGE' && err.status === 400;
    });

    // 2-frame animated WebP with distinct frames rejected when maxFrames: 1
    const frameRaw = Buffer.alloc(16 * 32 * 4);
    for (let i = 0; i < 16 * 16 * 4; i += 4) {
      frameRaw[i] = 255;
      frameRaw[i + 3] = 255;
    }
    for (let i = 16 * 16 * 4; i < 16 * 32 * 4; i += 4) {
      frameRaw[i + 2] = 255;
      frameRaw[i + 3] = 255;
    }
    const multiFrame = await sharp(frameRaw, {
      raw: { width: 16, height: 32, channels: 4, pageHeight: 16 },
    })
      .webp()
      .toBuffer();

    await expect(optimizeImage(multiFrame, { maxFrames: 1 })).rejects.toSatisfy((err: unknown) => {
      return isUploadKitError(err) && err.code === 'INVALID_IMAGE' && err.status === 400;
    });
  });

  it('normalizes output colorspace to sRGB when colorSpace: "srgb" is set', async () => {
    const cmykJpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .toColorspace('cmyk')
      .jpeg()
      .toBuffer();

    const beforeMeta = await sharp(cmykJpeg).metadata();
    expect(beforeMeta.space).toBe('cmyk');

    const result = await optimizeImage(cmykJpeg, {
      outputFormat: 'jpeg',
      colorSpace: 'srgb',
    });
    const afterMeta = await sharp(result.buffer).metadata();
    expect(afterMeta.space).toBe('srgb');
  });

  it('negotiates output format from Accept header while respecting explicit overrides', () => {
    expect(negotiateOutputFormat('image/avif,image/webp,image/png,*/*;q=0.8')).toBe('avif');
    expect(negotiateOutputFormat('image/webp,image/png,*/*;q=0.8')).toBe('webp');
    expect(negotiateOutputFormat('image/avif;q=0, image/webp;q=0.9, image/jpeg;q=1.0')).toBe('jpeg');
    expect(negotiateOutputFormat('image/avif,image/webp', { outputFormat: 'png' })).toBe('png');
    expect(negotiateOutputFormat(undefined, { hasAlpha: true })).toBe('png');
    expect(negotiateOutputFormat(null)).toBe('jpeg');
    expect(negotiateOutputFormat('image/avif,image/webp', { allowedFormats: ['webp', 'jpeg'] })).toBe(
      'webp',
    );
  });

  it('caches transform results with LRU eviction and deterministic keys', () => {
    const k1 = buildTransformCacheKey('abc123', {
      maxDimensions: { width: 800, height: 600 },
      aspectRatio: '1:1',
      focalPoint: { x: 0.25, y: 0.75 },
      outputFormat: 'webp',
      quality: 80,
    });
    const k2 = buildTransformCacheKey('abc123', {
      maxDimensions: { width: 800, height: 600 },
      aspectRatio: '1:1',
      focalPoint: { x: 0.25, y: 0.75 },
      outputFormat: 'webp',
      quality: 80,
    });
    const k3 = buildTransformCacheKey('abc123', { outputFormat: 'avif', quality: 80 });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);

    const cache = createMemoryTransformCache({ maxEntries: 2 });
    const sample = (n: number) => ({
      buffer: Buffer.from(`img-${n}`),
      width: 100,
      height: 100,
      format: 'webp' as const,
      size: 5,
    });

    cache.set('k1', sample(1));
    cache.set('k2', sample(2));
    // Touch k1 so k2 becomes least-recently-used
    expect(cache.get('k1')?.buffer.toString()).toBe('img-1');
    cache.set('k3', sample(3));

    expect(cache.size).toBe(2);
    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k1')).toBeDefined();
    expect(cache.get('k3')).toBeDefined();
  });
});
