import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLocalFsStorageAdapter,
  createMemoryStorageAdapter,
  createS3StorageAdapter,
  createSupabaseStorageAdapter,
  migrateStorage,
  normalizeStorageError,
  type SupabaseStorageClientLike,
} from '../../../src/storage';
import { isUploadKitError } from '../../../src/types/errors';

function mockSupabase(): SupabaseStorageClientLike {
  return {
    storage: {
      from: () => ({
        upload: async (p) => ({ data: { path: p }, error: null }),
        remove: async () => ({ error: null }),
        getPublicUrl: (p) => ({ data: { publicUrl: `https://sb.test/${p}` } }),
        list: async () => ({ data: [], error: null }),
        download: async () => ({ data: new Uint8Array([1]), error: null }),
        createSignedUrl: async (p, exp) => ({
          data: { signedUrl: `https://sb.test/signed/${p}?exp=${exp}` },
          error: null,
        }),
      }),
    },
  };
}

describe('Storage Security Hardening & Error Normalization', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('blocks .., ., and null-byte traversal in S3, Supabase, LocalFS, and Memory', async () => {
    const s3 = createS3StorageAdapter({
      publicBaseUrl: 'https://cdn.example.com',
      async putObject() {},
      async deleteObject() {},
    });
    const supabase = createSupabaseStorageAdapter(mockSupabase());
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-sec-'));
    tempDirs.push(rootDir);
    const local = createLocalFsStorageAdapter({ rootDir });
    const mem = createMemoryStorageAdapter();

    const badPaths = ['../secret.png', 'a/../../b.png', './dot.png', 'a/./b.png', 'evil\0.png'];
    for (const bad of badPaths) {
      const p = { bucket: 'b', path: bad, data: Buffer.from('x'), contentType: 'image/png' };
      await expect(s3.upload(p)).rejects.toThrow();
      await expect(s3.delete('b', bad)).rejects.toThrow();
      await expect(supabase.upload(p)).rejects.toThrow();
      await expect(supabase.delete('b', bad)).rejects.toThrow();
      await expect(supabase.download!('b', bad)).rejects.toThrow();
      await expect(local.upload(p)).rejects.toThrow();
      await expect(mem.upload(p)).rejects.toThrow();
      await expect(mem.delete('b', bad)).rejects.toThrow();
      await expect(mem.download('b', bad)).rejects.toThrow();
    }
  });

  it('blocks symlink directory escapes outside rootDir in LocalFsStorageAdapter', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-sym-'));
    tempDirs.push(base);
    const rootDir = path.join(base, 'uploads');
    const outsideDir = path.join(base, 'outside');
    await fs.mkdir(path.join(rootDir, 'media'), { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'top-secret');

    const linkPath = path.join(rootDir, 'media', 'escape');
    await fs.symlink(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

    const local = createLocalFsStorageAdapter({ rootDir });
    await expect(local.download('media', 'escape/secret.txt')).rejects.toThrow(/traversal/i);
    await expect(
      local.upload({
        bucket: 'media',
        path: 'escape/pwn.txt',
        data: Buffer.from('nope'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow(/traversal/i);
    expect(await local.exists('media', 'escape/secret.txt')).toBe(false);
  });

  it('normalizes provider errors into safe structured UploadKitError instances', () => {
    const forbidden = normalizeStorageError(
      { code: 'AccessDenied', message: 'Secret ARN arn:aws:s3:::priv denied' },
      { provider: 's3', operation: 'upload' },
    );
    expect(isUploadKitError(forbidden)).toBe(true);
    expect(forbidden.code).toBe('FORBIDDEN');
    expect(forbidden.retryable).toBe(false);
    expect(forbidden.message).not.toContain('arn:aws');

    const rateLimited = normalizeStorageError({ statusCode: 429, code: 'SlowDown' });
    expect(rateLimited.code).toBe('RATE_LIMITED');
    expect(rateLimited.retryable).toBe(true);

    const quota = normalizeStorageError({ code: 'ENOSPC', message: 'no space left on /var/data' });
    expect(quota.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(quota.retryable).toBe(true);
    expect(quota.message).not.toContain('/var/data');

    const timeout = normalizeStorageError({ code: 'ETIMEDOUT' });
    expect(timeout.code).toBe('STORAGE_ERROR');
    expect(timeout.retryable).toBe(true);
  });
});

describe('Storage HealthCheck, Presigned Download & Multipart Lifecycle', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('supports healthCheck and createPresignedDownload across adapters', async () => {
    const mem = createMemoryStorageAdapter();
    expect((await mem.healthCheck()).ok).toBe(true);
    const memSigned = await mem.createPresignedDownload('media', 'a.avif', { expiresInSeconds: 60 });
    expect(memSigned.url).toContain('memory://signed-download/media/a.avif');
    expect(memSigned.expiresAt).toBeTruthy();

    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-hc-'));
    tempDirs.push(rootDir);
    const local = createLocalFsStorageAdapter({ rootDir });
    expect((await local.healthCheck()).ok).toBe(true);

    const s3 = createS3StorageAdapter({
      publicBaseUrl: 'https://cdn.example.com',
      defaultBucket: 'assets',
      async putObject() {},
      async deleteObject() {},
      async listObjectsV2() { return { Contents: [] }; },
      async presignDownload(bucket, key) {
        return { url: `https://signed.example.com/${bucket}/${key}?sig=1` };
      },
    });
    expect((await s3.healthCheck!()).ok).toBe(true);
    expect((await s3.createPresignedDownload!('assets', 'hero.avif')).url).toBe(
      'https://signed.example.com/assets/hero.avif?sig=1',
    );

    const supabase = createSupabaseStorageAdapter(mockSupabase());
    expect((await supabase.healthCheck!()).ok).toBe(true);
    const sbSigned = await supabase.createPresignedDownload!('media', 'pic.webp', { expiresInSeconds: 120 });
    expect(sbSigned.url).toContain('exp=120');
  });

  it('completes and aborts multipart uploads on Memory and S3 mock', async () => {
    const mem = createMemoryStorageAdapter();
    const init = await mem.createMultipartUpload({
      bucket: 'media', path: 'big/poster.avif', contentType: 'image/avif',
    });
    const p1 = await mem.uploadPart({
      bucket: 'media', path: init.path, uploadId: init.uploadId, partNumber: 1, data: Buffer.from('hello-'),
    });
    const p2 = await mem.uploadPart({
      bucket: 'media', path: init.path, uploadId: init.uploadId, partNumber: 2, data: Buffer.from('world'),
    });
    const done = await mem.completeMultipartUpload({
      bucket: 'media', path: init.path, uploadId: init.uploadId, parts: [p2, p1],
    });
    expect(done.path).toBe('big/poster.avif');
    expect(Buffer.from(await mem.download('media', init.path)).toString('utf8')).toBe('hello-world');

    const aborted = await mem.createMultipartUpload({
      bucket: 'media', path: 'aborted.avif', contentType: 'image/avif',
    });
    await mem.abortMultipartUpload({ bucket: 'media', path: aborted.path, uploadId: aborted.uploadId });
    await expect(
      mem.uploadPart({
        bucket: 'media', path: aborted.path, uploadId: aborted.uploadId, partNumber: 1, data: Buffer.from('x'),
      }),
    ).rejects.toThrow();

    const s3Events: string[] = [];
    const s3 = createS3StorageAdapter({
      publicBaseUrl: 'https://cdn.example.com',
      async putObject() {},
      async deleteObject() {},
      async createMultipartUpload() { s3Events.push('create'); return { UploadId: 's3-up-1' }; },
      async uploadPart(i) { s3Events.push(`part:${i.PartNumber}`); return { ETag: `"etag-${i.PartNumber}"` }; },
      async completeMultipartUpload() { s3Events.push('complete'); },
      async abortMultipartUpload() { s3Events.push('abort'); },
    });
    const s3Init = await s3.createMultipartUpload!({ bucket: 'b', path: 'k.avif', contentType: 'image/avif' });
    const s3Part = await s3.uploadPart!({
      bucket: 'b', path: 'k.avif', uploadId: s3Init.uploadId, partNumber: 1, data: Buffer.from('abc'),
    });
    const s3Done = await s3.completeMultipartUpload!({
      bucket: 'b', path: 'k.avif', uploadId: s3Init.uploadId, parts: [s3Part],
    });
    expect(s3Done.url).toBe('https://cdn.example.com/b/k.avif');
    await s3.abortMultipartUpload!({ bucket: 'b', path: 'k.avif', uploadId: s3Init.uploadId });
    expect(s3Events).toEqual(['create', 'part:1', 'complete', 'abort']);
  });
});

describe('migrateStorage', () => {
  it('supports dry-run, cursor resume, SHA-256 integrity, and guarded source deletion', async () => {
    const source = createMemoryStorageAdapter();
    const target = createMemoryStorageAdapter();
    for (const name of ['a.webp', 'b.webp', 'c.webp']) {
      await source.upload({
        bucket: 'src', path: `gallery/${name}`, data: Buffer.from(`payload-${name}`), contentType: 'image/webp',
      });
    }

    await expect(
      migrateStorage({ source, target, sourceBucket: 'src', deleteSource: true }),
    ).rejects.toThrow(/confirmDestructive/);

    const dry = await migrateStorage({
      source, target, sourceBucket: 'src', targetBucket: 'dst', folder: 'gallery', dryRun: true,
    });
    expect(dry).toMatchObject({ dryRun: true, copied: 0, skipped: 3, failed: 0, deletedSource: 0 });
    expect(target.size).toBe(0);

    const page1 = await migrateStorage({
      source, target, sourceBucket: 'src', targetBucket: 'dst', folder: 'gallery', limit: 2, verifyIntegrity: true,
    });
    expect(page1).toMatchObject({ copied: 2, failed: 0, nextCursor: '2' });

    const page2 = await migrateStorage({
      source, target, sourceBucket: 'src', targetBucket: 'dst', folder: 'gallery',
      cursor: page1.nextCursor, limit: 2, verifyIntegrity: true,
    });
    expect(page2).toMatchObject({ copied: 1, failed: 0, nextCursor: undefined });
    expect(target.size).toBe(3);
    expect(source.size).toBe(3);

    const target2 = createMemoryStorageAdapter();
    const moved = await migrateStorage({
      source, target: target2, sourceBucket: 'src', targetBucket: 'dst2', folder: 'gallery',
      verifyIntegrity: true, deleteSource: true, confirmDestructive: true,
    });
    expect(moved).toMatchObject({ copied: 3, deletedSource: 3, failed: 0 });
    expect(source.size).toBe(0);
    expect(target2.size).toBe(3);
  });
});
