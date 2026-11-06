import { describe, expect, it } from 'vitest';
import { createMemoryStorageAdapter, defineUploadPresets } from '../src';
import {
  buildVariantStoragePath,
  createImageUploader,
} from '../src/server';
import { SAFE_SVG, solidImage } from './helpers/imageFixtures';

describe('Phase 7a: Responsive Image Variants (Server)', () => {
  it('buildVariantStoragePath inserts -<width>w before file extension', () => {
    expect(buildVariantStoragePath('hero/2026/11/banner.avif', 640)).toBe(
      'hero/2026/11/banner-640w.avif',
    );
    expect(buildVariantStoragePath('avatar.v1.webp', 320)).toBe(
      'avatar.v1-320w.webp',
    );
    expect(buildVariantStoragePath('folder.with.dots/noext', 480)).toBe(
      'folder.with.dots/noext-480w',
    );
  });

  it('generates sorted responsive variants smaller than main width and builds srcSet', async () => {
    const storage = createMemoryStorageAdapter();
    const presets = defineUploadPresets({
      banner: {
        folder: 'banners',
        maxDimensions: { width: 1200, height: 800 },
        outputFormat: 'webp',
        quality: 82,
        variantWidths: [960, 320, 1200, 1600, 640, -100, 320],
      },
    });
    const uploader = createImageUploader({ storage, presets });
    const source = await solidImage(1000, 500, 'png', '#2266aa');

    const result = await uploader.uploadImage(
      { buffer: source, name: 'hero.png', type: 'image/png' },
      { preset: 'banner' },
    );

    expect(result.width).toBe(1000);
    expect(result.height).toBe(500);
    expect(result.variants).toBeDefined();
    // 1200 and 1600 are >= 1000 so skipped; 320, 640, 960 sorted ascending
    expect(result.variants!.map((v) => v.width)).toEqual([320, 640, 960]);
    expect(result.variants!.map((v) => v.height)).toEqual([160, 320, 480]);

    for (const v of result.variants!) {
      expect(v.url).toContain(`-${v.width}w.webp`);
      expect(v.storagePath).toContain(`-${v.width}w.webp`);
      expect(v.size).toBeGreaterThan(0);
    }

    const expectedSrcSet = [
      ...result.variants!.map((v) => `${v.url} ${v.width}w`),
      `${result.url} 1000w`,
    ].join(', ');
    expect(result.srcSet).toBe(expectedSrcSet);

    const listed = await storage.list('images', 'banners');
    expect(listed.items.length).toBe(4); // 1 main + 3 variants
  });

  it('supports per-call variantWidths override and omits variants when all widths >= image width', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const small = await solidImage(300, 200, 'png');

    const noSmaller = await uploader.uploadImage(
      { buffer: small, name: 'small.png', type: 'image/png' },
      { variantWidths: [300, 640, 1024], outputFormat: 'webp' },
    );
    expect(noSmaller.variants).toBeUndefined();
    expect(noSmaller.srcSet).toBeUndefined();

    const withOne = await uploader.uploadImage(
      { buffer: small, name: 'small2.png', type: 'image/png' },
      { variantWidths: [150, 400], outputFormat: 'webp' },
    );
    expect(withOne.variants).toHaveLength(1);
    expect(withOne.variants![0].width).toBe(150);
    expect(withOne.srcSet).toContain('150w');
    expect(withOne.srcSet).toContain('300w');
  });

  it('skips variant generation for SVG uploads even when variantWidths is set', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, allowSvg: true });
    const svgBuf = Buffer.from(SAFE_SVG, 'utf8');

    const result = await uploader.uploadImage(
      { buffer: svgBuf, name: 'logo.svg', type: 'image/svg+xml' },
      { allowSvg: true, variantWidths: [16, 32] },
    );

    expect(result.format).toBe('svg');
    expect(result.variants).toBeUndefined();
    expect(result.srcSet).toBeUndefined();
  });

  it('deleteImage and deleteByUrl remove both the main object and all stored variants', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({
      storage,
      presets: defineUploadPresets({
        gallery: {
          folder: 'gallery',
          outputFormat: 'webp',
          variantWidths: [200, 400],
        },
      }),
    });
    const img = await solidImage(600, 400, 'png');

    const first = await uploader.uploadImage(
      { buffer: img, name: 'one.png', type: 'image/png' },
      { preset: 'gallery' },
    );
    expect((await storage.list('images', 'gallery')).items).toHaveLength(3);

    await uploader.deleteImage(first.storagePath!, first.bucket);
    expect((await storage.list('images', 'gallery')).items).toHaveLength(0);

    const second = await uploader.uploadImage(
      { buffer: img, name: 'two.png', type: 'image/png' },
      { preset: 'gallery' },
    );
    expect((await storage.list('images', 'gallery')).items).toHaveLength(3);

    const deleted = await uploader.deleteByUrl(second.url);
    expect(deleted).toBe(true);
    expect((await storage.list('images', 'gallery')).items).toHaveLength(0);
  });

  it('rolls back stored variants when awaited onUploadRecord throws', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({
      storage,
      awaitRecordHook: true,
      onUploadRecord: () => {
        throw new Error('DB write failed');
      },
    });
    const img = await solidImage(500, 400, 'png');

    await expect(
      uploader.uploadImage(
        { buffer: img, name: 'rollback.png', type: 'image/png' },
        { folder: 'rb', outputFormat: 'webp', variantWidths: [200, 350] },
      ),
    ).rejects.toThrow('DB write failed');

    const remaining = await storage.list('images', 'rb');
    expect(remaining.items).toHaveLength(0);
  });
});
