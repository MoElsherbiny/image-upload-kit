import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLocalFsStorageAdapter,
  createMemoryStorageAdapter,
  createS3StorageAdapter,
  createSupabaseStorageAdapter,
  parsePublicStorageUrl,
  type SupabaseStorageClientLike,
} from '../src/storage';

describe('parsePublicStorageUrl', () => {
  it('extracts bucket, path, filename, and extension from public storage URLs', () => {
    const parsed = parsePublicStorageUrl(
      'https://demo.supabase.co/storage/v1/object/public/media/catalog/item-01.avif?v=1',
    );
    expect(parsed).toEqual({
      bucket: 'media',
      path: 'catalog/item-01.avif',
      filename: 'item-01.avif',
      extension: '.avif',
    });

    expect(parsePublicStorageUrl('')).toBeNull();
    expect(parsePublicStorageUrl('https://example.com/not-storage/a.png')).toBeNull();
    expect(
      parsePublicStorageUrl('https://demo.supabase.co/storage/v1/object/public/only-bucket'),
    ).toBeNull();
  });
});

describe('createMemoryStorageAdapter', () => {
  it('supports upload, duplicate rejection when upsert is false, list, delete, and deleteByUrl', async () => {
    const adapter = createMemoryStorageAdapter({ baseUrl: 'https://mem.test/files' });
    const bytes = Buffer.from('hello-image');

    const first = await adapter.upload({
      bucket: 'media',
      path: '/products/shoe.webp',
      data: bytes,
      contentType: 'image/webp',
      upsert: false,
    });

    expect(first).toEqual({
      bucket: 'media',
      path: 'products/shoe.webp',
      url: 'https://mem.test/files/media/products/shoe.webp',
    });
    expect(adapter.getPublicUrl?.('media', 'products/shoe.webp')).toBe(
      'https://mem.test/files/media/products/shoe.webp',
    );

    await expect(
      adapter.upload({
        bucket: 'media',
        path: 'products/shoe.webp',
        data: bytes,
        contentType: 'image/webp',
        upsert: false,
      }),
    ).rejects.toThrow('Object already exists at media/products/shoe.webp');

    await adapter.upload({
      bucket: 'media',
      path: 'products/hat.webp',
      data: Buffer.from('hat-bytes'),
      contentType: 'image/webp',
      upsert: true,
    });

    const listed = await adapter.list?.('media', 'products');
    expect(listed?.map((e) => e.name).sort()).toEqual(['hat.webp', 'shoe.webp']);

    await adapter.delete('media', 'products/hat.webp');
    expect(adapter.getObject('media', 'products/hat.webp')).toBeUndefined();

    expect(await adapter.deleteByUrl?.(first.url)).toBe(true);
    expect(await adapter.deleteByUrl?.(first.url)).toBe(false);
    expect(await adapter.deleteByUrl?.('https://other.host/file.webp')).toBe(false);
  });
});

describe('createLocalFsStorageAdapter', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('writes, lists, deletes on disk, and prevents ../ path traversal escapes', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-test-'));
    tempDirs.push(tempRoot);

    const storageRoot = path.join(tempRoot, 'uploads');
    const adapter = createLocalFsStorageAdapter({
      rootDir: storageRoot,
      baseUrl: '/static/uploads',
    });

    const uploaded = await adapter.upload({
      bucket: 'gallery',
      path: '2026/photo.avif',
      data: Buffer.from('avif-binary'),
      contentType: 'image/avif',
      upsert: false,
    });

    expect(uploaded.url).toBe('/static/uploads/gallery/2026/photo.avif');

    await expect(
      adapter.upload({
        bucket: 'gallery',
        path: '2026/photo.avif',
        data: Buffer.from('dup'),
        contentType: 'image/avif',
        upsert: false,
      }),
    ).rejects.toThrow('File already exists');

    const entries = await adapter.list?.('gallery', '2026');
    expect(entries).toHaveLength(1);
    expect(entries?.[0].name).toBe('photo.avif');

    // Pure traversal segments must be rejected outright
    await expect(
      adapter.upload({
        bucket: 'gallery',
        path: '../..',
        data: Buffer.from('bad'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('Invalid storage path');

    // Relative ../secret.txt must be rejected and never escape outside storageRoot into tempRoot
    await expect(
      adapter.upload({
        bucket: 'gallery',
        path: '../secret.txt',
        data: Buffer.from('confined'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('Invalid storage path');
    await expect(fs.access(path.join(tempRoot, 'secret.txt'))).rejects.toThrow();

    await adapter.delete('gallery', '2026/photo.avif');
    expect(await adapter.list?.('gallery', '2026')).toEqual([]);
  });
});

describe('createSupabaseStorageAdapter', () => {
  it('uploads, resolves public URLs, lists, removes, and deletes .avif variants by URL', async () => {
    const buckets = new Map<string, Map<string, Uint8Array>>();
    const removedBatches: string[][] = [];

    const getBucket = (name: string) => {
      const existing = buckets.get(name);
      if (existing) return existing;
      const created = new Map<string, Uint8Array>();
      buckets.set(name, created);
      return created;
    };

    const mockClient: SupabaseStorageClientLike = {
      storage: {
        from(bucket: string) {
          const store = getBucket(bucket);
          return {
            async upload(filePath, fileBody) {
              store.set(filePath, new Uint8Array(fileBody));
              return { data: { path: filePath }, error: null };
            },
            async remove(paths) {
              removedBatches.push(paths);
              for (const p of paths) store.delete(p);
              return { data: paths, error: null };
            },
            getPublicUrl(filePath) {
              return {
                data: {
                  publicUrl: `https://mock.supabase.co/storage/v1/object/public/${bucket}/${filePath}`,
                },
              };
            },
            async list(folder) {
              const prefix = folder ? `${folder.replace(/\/+$/, '')}/` : '';
              const items = [...store.keys()]
                .filter((k) => k.startsWith(prefix))
                .map((k) => ({
                  name: k.slice(prefix.length),
                  id: `id-${k}`,
                  created_at: '2026-01-01T00:00:00.000Z',
                }));
              return { data: items, error: null };
            },
          };
        },
      },
    };

    const adapter = createSupabaseStorageAdapter(mockClient);
    const res = await adapter.upload({
      bucket: 'media',
      path: 'items/card.avif',
      data: Buffer.from('avif-data'),
      contentType: 'image/avif',
    });

    expect(res.url).toBe('https://mock.supabase.co/storage/v1/object/public/media/items/card.avif');
    expect(adapter.getPublicUrl?.('media', 'items/card.avif')).toBe(res.url);

    const listed = await adapter.list?.('media', 'items');
    expect(listed).toEqual([
      { name: 'card.avif', id: 'id-items/card.avif', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    expect(await adapter.deleteByUrl?.(res.url)).toBe(true);
    expect(removedBatches[0]).toEqual(['items/card.avif']);

    await adapter.upload({
      bucket: 'media',
      path: 'items/icon.png',
      data: Buffer.from('png'),
      contentType: 'image/png',
    });
    await adapter.delete('media', 'items/icon.png');
    expect(await adapter.list?.('media', 'items')).toEqual([]);
  });
});

describe('createS3StorageAdapter', () => {
  it('uploads, lists, resolves CDN URLs, and deletes by key or URL without AWS SDK lock-in', async () => {
    const objects = new Map<string, { size: number; modified: Date }>();

    const s3Adapter = createS3StorageAdapter({
      publicBaseUrl: 'https://cdn.example.com',
      includeBucketInUrl: false,
      defaultBucket: 'r2-assets',
      async putObject(input) {
        objects.set(`${input.Bucket}/${input.Key}`, {
          size: input.Body.byteLength,
          modified: new Date('2026-02-01T00:00:00.000Z'),
        });
      },
      async deleteObject(input) {
        objects.delete(`${input.Bucket}/${input.Key}`);
      },
      async listObjectsV2(input) {
        const prefix = input.Prefix ?? '';
        const Contents = [...objects.entries()]
          .filter(([k]) => k.startsWith(`${input.Bucket}/${prefix}`))
          .map(([k, v]) => ({
            Key: k.slice(input.Bucket.length + 1),
            Size: v.size,
            LastModified: v.modified,
          }));
        return { Contents };
      },
    });

    const uploaded = await s3Adapter.upload({
      bucket: 'r2-assets',
      path: 'catalog/hero.avif',
      data: Buffer.from('avif-payload'),
      contentType: 'image/avif',
    });

    expect(uploaded.url).toBe('https://cdn.example.com/catalog/hero.avif');
    const list = await s3Adapter.list?.('r2-assets', 'catalog');
    expect(list).toHaveLength(1);
    expect(list?.[0].name).toBe('hero.avif');

    expect(await s3Adapter.deleteByUrl?.(uploaded.url)).toBe(true);
    expect(await s3Adapter.list?.('r2-assets', 'catalog')).toEqual([]);
  });
});
