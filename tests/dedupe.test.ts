import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeDedupeKey,
  createImageUploader,
  createMemoryDedupeStore,
} from '../src/server';
import { createMemoryStorageAdapter } from '../src/storage';

let samplePngBuffer: Buffer;

beforeAll(async () => {
  samplePngBuffer = await sharp({
    create: {
      width: 240,
      height: 180,
      channels: 3,
      background: { r: 59, g: 130, b: 246 },
    },
  })
    .png()
    .toBuffer();
});

describe('computeDedupeKey & createMemoryDedupeStore', () => {
  it('produces identical keys regardless of setting property order and normalizes variantWidths', async () => {
    const keyA = await computeDedupeKey(samplePngBuffer, {
      bucket: 'media',
      preset: 'square',
      quality: 85,
      variantWidths: [800, 400, 400],
      maxDimensions: { width: 1200, height: 1200 },
    });
    const keyB = await computeDedupeKey(samplePngBuffer, {
      maxDimensions: { height: 1200, width: 1200 },
      variantWidths: [400, 800],
      quality: 85,
      preset: 'square',
      bucket: 'media',
    });
    const keyDifferentPreset = await computeDedupeKey(samplePngBuffer, {
      bucket: 'media',
      preset: 'avatar',
      quality: 85,
      variantWidths: [400, 800],
      maxDimensions: { width: 1200, height: 1200 },
    });

    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(keyDifferentPreset);
  });

  it('enforces LRU maxEntries bound on createMemoryDedupeStore', async () => {
    const store = createMemoryDedupeStore({ maxEntries: 2 });
    const baseData = {
      url: 'https://cdn.test/1.avif',
      blurDataUrl: 'data:image/webp;base64,AAA',
      blurColor: '#112233',
      width: 100,
      height: 100,
      format: 'avif' as const,
      size: 500,
      contentHash: 'abc',
      storagePath: '1.avif',
      bucket: 'images',
      uploadedAt: new Date().toISOString(),
    };

    await store.set('k1', { ...baseData, url: 'https://cdn.test/1.avif', storagePath: '1.avif' });
    await store.set('k2', { ...baseData, url: 'https://cdn.test/2.avif', storagePath: '2.avif' });
    // Access k1 so k2 becomes the oldest
    expect(await store.get('k1')).not.toBeNull();

    await store.set('k3', { ...baseData, url: 'https://cdn.test/3.avif', storagePath: '3.avif' });
    expect(await store.get('k1')).not.toBeNull();
    expect(await store.get('k2')).toBeNull();
    expect(await store.get('k3')).not.toBeNull();
  });
});

describe('createImageUploader content-hash deduplication', () => {
  it('reuses existing upload on identical bytes + preset and only calls storage.upload once', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploadSpy = vi.spyOn(storage, 'upload');

    const uploader = createImageUploader({
      storage,
      defaultBucket: 'media',
      deduplicate: true,
    });

    const first = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'photo.png', type: 'image/png' },
      { preset: 'avatar', altText: 'First alt' },
    );

    expect(first.deduplicated).toBeUndefined();
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    const second = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'duplicate.png', type: 'image/png' },
      { preset: 'avatar', altText: 'Updated alt' },
    );

    expect(second.deduplicated).toBe(true);
    expect(second.url).toBe(first.url);
    expect(second.storagePath).toBe(first.storagePath);
    expect(second.altText).toBe('Updated alt');
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it('produces distinct uploads when the same image bytes are uploaded with different presets', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploadSpy = vi.spyOn(storage, 'upload');

    const uploader = createImageUploader({
      storage,
      defaultBucket: 'media',
      deduplicate: true,
    });

    const avatarImg = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'user.png', type: 'image/png' },
      { preset: 'avatar' },
    );
    const squareImg = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'user.png', type: 'image/png' },
      { preset: 'square' },
    );

    expect(avatarImg.deduplicated).toBeUndefined();
    expect(squareImg.deduplicated).toBeUndefined();
    expect(avatarImg.url).not.toBe(squareImg.url);
    expect(uploadSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('detects out-of-band storage deletion via verifyExists, evicts stale entry, and re-uploads', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploadSpy = vi.spyOn(storage, 'upload');

    const uploader = createImageUploader({
      storage,
      defaultBucket: 'media',
      deduplicate: { verifyExists: true },
    });

    const first = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'item.png', type: 'image/png' },
      { preset: 'thumbnail' },
    );
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    // Out-of-band deletion directly on storage adapter
    await storage.delete('media', first.storagePath!);
    expect(await storage.exists('media', first.storagePath!)).toBe(false);

    const reuploaded = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'item.png', type: 'image/png' },
      { preset: 'thumbnail' },
    );

    expect(reuploaded.deduplicated).toBeUndefined();
    expect(uploadSpy).toHaveBeenCalledTimes(2);
    expect(await storage.exists('media', reuploaded.storagePath!)).toBe(true);
  });

  it('evicts deduplication cache entries when uploader.deleteImage or uploader.deleteByUrl is called', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const store = createMemoryDedupeStore();
    const uploadSpy = vi.spyOn(storage, 'upload');

    const uploader = createImageUploader({
      storage,
      defaultBucket: 'media',
      deduplicate: { store, verifyExists: false },
    });

    const first = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'pic.png', type: 'image/png' },
      { preset: 'thumbnail' },
    );
    expect(uploadSpy).toHaveBeenCalledTimes(1);

    // Delete via uploader.deleteImage -> should evict from store even with verifyExists: false
    await uploader.deleteImage(first.storagePath!, 'media');

    const second = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'pic.png', type: 'image/png' },
      { preset: 'thumbnail' },
    );
    expect(second.deduplicated).toBeUndefined();
    expect(uploadSpy).toHaveBeenCalledTimes(2);

    // Delete via uploader.deleteByUrl -> should also evict from store
    expect(await uploader.deleteByUrl(second.url)).toBe(true);

    const third = await uploader.uploadImage(
      { buffer: samplePngBuffer, name: 'pic.png', type: 'image/png' },
      { preset: 'thumbnail' },
    );
    expect(third.deduplicated).toBeUndefined();
    expect(uploadSpy).toHaveBeenCalledTimes(3);
  });
});
