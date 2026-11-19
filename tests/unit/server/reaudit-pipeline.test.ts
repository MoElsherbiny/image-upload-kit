import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { defineUploadPresets } from '../../../src';
import {
  createImageUploader, createMemoryDedupeStore, createUploadHttpHandler,
  isCollisionError, optimizeImage, sanitizeSvg, UploadValidationError,
} from '../../../src/server';
import {
  createMemoryStorageAdapter, createS3StorageAdapter, createSupabaseStorageAdapter,
  normalizeStorageError, type StorageAdapter,
} from '../../../src/storage';
import { isUploadKitError } from '../../../src/types/errors';

const makePng = (width = 96, height = 96, r = 40): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: { r, g: 120, b: 210 } } }).png().toBuffer();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('M-2: In-flight dedupe coalescing isolates caller AbortSignals', () => {
  it('aborting the primary caller during Sharp processing does not cancel coalesced callers', async () => {
    const base = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test' });
    const baseDedupe = createMemoryDedupeStore();
    let uploadCalls = 0;
    let secondQueued!: () => void;
    const secondReady = new Promise<void>((r) => { secondQueued = r; });
    let releaseProcessing!: () => void;
    const gate = new Promise<void>((r) => { releaseProcessing = r; });
    let lookups = 0;

    const uploader = createImageUploader({
      storage: { ...base, async upload(p) { uploadCalls += 1; return base.upload(p); } },
      deduplicate: {
        store: {
          ...baseDedupe,
          async get(k) {
            lookups += 1;
            const hit = await baseDedupe.get(k);
            if (lookups === 2) setTimeout(secondQueued, 0);
            return hit;
          },
        },
      },
      transformCache: { async get() { await gate; return undefined; }, async set() {} },
    });

    const buf = await makePng(64, 64, 55);
    const primaryAbort = new AbortController();
    const p1 = uploader.uploadImage(
      { buffer: buf, name: 'a.png', type: 'image/png' },
      { signal: primaryAbort.signal, altText: 'Primary' },
    );
    const p2 = uploader.uploadImage(
      { buffer: buf, name: 'b.png', type: 'image/png' },
      { altText: 'Innocent' },
    );

    await secondReady;
    primaryAbort.abort();
    await expect(p1).rejects.toSatisfy(
      (e: unknown) => isUploadKitError(e) && e.code === 'UPLOAD_CANCELLED' && e.status === 499,
    );
    expect(uploadCalls).toBe(0);
    releaseProcessing();

    const res2 = await p2;
    expect(res2.deduplicated).toBe(true);
    expect(res2.altText).toBe('Innocent');
    expect(uploadCalls).toBe(1);
    expect(base.size).toBe(1);
  });

  it('aborts shared execution and cleans up only when every attached caller aborts', async () => {
    const base = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test' });
    let uploadStarted!: () => void;
    const started = new Promise<void>((r) => { uploadStarted = r; });
    const storage: StorageAdapter = {
      ...base,
      async upload(params) {
        uploadStarted();
        await sleep(40);
        return base.upload(params);
      },
    };
    const uploader = createImageUploader({ storage, deduplicate: true });
    const buf = await makePng(64, 64, 88);
    const ac1 = new AbortController();
    const ac2 = new AbortController();

    const p1 = uploader.uploadImage({ buffer: buf, type: 'image/png' }, { signal: ac1.signal });
    const p2 = uploader.uploadImage({ buffer: buf, type: 'image/png' }, { signal: ac2.signal });

    await started;
    ac1.abort();
    ac2.abort();

    await expect(p1).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });
    await expect(p2).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });
    expect(base.size).toBe(0);

    const fresh = await uploader.uploadImage({ buffer: buf, type: 'image/png' });
    expect(fresh.deduplicated).toBeUndefined();
    expect(base.size).toBe(1);
  });
});

describe('M-3: Storage errors normalize to UploadKitError while preserving collision retries', () => {
  it('maps S3 503 during upload/delete/download to retryable STORAGE_ERROR without leaking secrets', async () => {
    const s3 = createS3StorageAdapter({
      publicBaseUrl: 'https://cdn.example.com',
      defaultBucket: 'media',
      async putObject() {
        throw Object.assign(new Error('arn:aws:s3:::priv-bucket/secret-key SlowDown'), {
          $metadata: { httpStatusCode: 503 }, name: 'ServiceUnavailable',
        });
      },
      async deleteObject() {
        throw Object.assign(new Error('AccessDenied for AKIAIOSFODNN7EXAMPLE'), {
          $metadata: { httpStatusCode: 403 }, code: 'AccessDenied',
        });
      },
      async getObject() {
        throw Object.assign(new Error('ETIMEDOUT 10.0.0.12'), { code: 'ETIMEDOUT' });
      },
    });

    const uploader = createImageUploader({ storage: s3, defaultBucket: 'media' });
    const png = await makePng(48, 48);

    await expect(uploader.uploadImage({ buffer: png, name: 'x.png', type: 'image/png' })).rejects.toSatisfy(
      (e: unknown) =>
        isUploadKitError(e) && e.code === 'STORAGE_ERROR' && e.status === 503 &&
        e.retryable === true && !e.message.includes('arn:aws'),
    );

    const handler = createUploadHttpHandler({ uploader });
    const form = new FormData();
    form.append('file', new File([new Uint8Array(png)], 'x.png', { type: 'image/png' }));
    const postRes = await handler.POST(new Request('http://localhost/api/upload', { method: 'POST', body: form }));
    expect([502, 503]).toContain(postRes.status);
    const postBody = (await postRes.json()) as { error: string; code: string; retryable: boolean };
    expect(postBody.code).toBe('STORAGE_ERROR');
    expect(postBody.retryable).toBe(true);
    expect(postBody.error).not.toContain('arn:aws');

    await expect(uploader.deleteImage('item.avif')).rejects.toSatisfy(
      (e: unknown) =>
        isUploadKitError(e) && e.code === 'FORBIDDEN' && e.status === 403 && !e.message.includes('AKIA'),
    );
    await expect(s3.download!('media', 'item.avif')).rejects.toSatisfy(
      (e: unknown) => isUploadKitError(e) && e.code === 'STORAGE_ERROR' && e.retryable === true,
    );

    const supa = createSupabaseStorageAdapter({
      storage: {
        from: () => ({
          upload: async () => ({ data: null, error: { message: 'rate limit exceeded /var/secret' } }),
          remove: async () => ({ error: { message: 'forbidden role key' } }),
          getPublicUrl: (p) => ({ data: { publicUrl: `https://sb.test/${p}` } }),
        }),
      },
    });
    await expect(
      supa.upload({ bucket: 'b', path: 'k.png', data: png, contentType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    await expect(supa.delete('b', 'k.png')).rejects.toMatchObject({ code: 'FORBIDDEN', retryable: false });
  });

  it('preserves S3 412 PreconditionFailed rename-retry and cause inspection in isCollisionError', async () => {
    let puts = 0;
    const s3 = createS3StorageAdapter({
      publicBaseUrl: 'https://cdn.example.com',
      async putObject() {
        puts += 1;
        if (puts === 1) {
          throw Object.assign(new Error('PreconditionFailed'), {
            $metadata: { httpStatusCode: 412 }, name: 'PreconditionFailed',
          });
        }
      },
      async deleteObject() {},
    });

    let generated = 0;
    const uploader = createImageUploader({
      storage: s3,
      pathGenerator: (ctx) => {
        generated += 1;
        const name = generated === 1 ? 'dup.avif' : 'unique.avif';
        return { bucket: ctx.bucket, path: name, filename: name };
      },
    });

    const uploaded = await uploader.uploadImage({ buffer: await makePng(32, 32), type: 'image/png' });
    expect(puts).toBe(2);
    expect(uploaded.storagePath).toBe('unique.avif');
    expect(isCollisionError(normalizeStorageError({ $metadata: { httpStatusCode: 412 }, code: 'EEXIST' }))).toBe(true);
  });
});

describe('L-1 & L-2: Post-processing abort rollback and cleanup error reporting', () => {
  it('L-1: aborts during slow storage.upload, deletes written object, and forwards signal on S3', async () => {
    const mem = createMemoryStorageAdapter();
    const ac = new AbortController();
    const slowStorage: StorageAdapter = {
      ...mem,
      async upload(params) {
        setTimeout(() => ac.abort(), 8);
        await sleep(30);
        return mem.upload(params);
      },
    };
    const uploader = createImageUploader({ storage: slowStorage });
    await expect(
      uploader.uploadImage(
        { buffer: await makePng(40, 40), name: 'slow.png', type: 'image/png' },
        { signal: ac.signal },
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isUploadKitError(e) && e.code === 'UPLOAD_CANCELLED' && e.status === 499,
    );
    expect(mem.size).toBe(0);

    let receivedSignal: AbortSignal | undefined;
    const s3 = createS3StorageAdapter({
      publicBaseUrl: 'https://cdn.example.com',
      async putObject(_input, opts) { receivedSignal = opts?.abortSignal; },
      async deleteObject() {},
    });
    const s3Ac = new AbortController();
    await s3.upload({ bucket: 'b', path: 'a.avif', data: Buffer.from('x'), contentType: 'image/avif', signal: s3Ac.signal });
    expect(receivedSignal).toBe(s3Ac.signal);
  });

  it('L-2: reports rollback storage.delete failures via onError with action="cleanup"', async () => {
    const mem = createMemoryStorageAdapter();
    const onError = vi.fn();
    let uploadIdx = 0;
    const flakyStorage: StorageAdapter = {
      ...mem,
      async upload(params) {
        uploadIdx += 1;
        if (uploadIdx === 2) throw new Error('Variant write failed');
        return mem.upload(params);
      },
      async delete() { throw new Error('Cleanup delete failed'); },
    };

    const uploader = createImageUploader({
      storage: flakyStorage,
      onError,
      presets: defineUploadPresets({ heroWithVars: { maxDimensions: { width: 200, height: 200 }, variantWidths: [60] } }),
    });
    await expect(
      uploader.uploadImage({ buffer: await makePng(140, 140), type: 'image/png' }, { preset: 'heroWithVars' }),
    ).rejects.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { action: 'cleanup' });

    const hookErr = vi.fn();
    const hookRollbackUploader = createImageUploader({
      storage: { ...mem, async delete() { throw new Error('Hook rollback delete failed'); } },
      awaitRecordHook: true,
      onUploadRecord: async () => { throw new Error('DB down'); },
      onError: hookErr,
    });
    await expect(hookRollbackUploader.uploadImage({ buffer: await makePng(32, 32), type: 'image/png' })).rejects.toThrow('DB down');
    expect(hookErr).toHaveBeenCalledWith(expect.any(Error), { action: 'cleanup' });
  });
});

describe('L-4 & L-5: MemoryAdapter key sanitization and prefixed <svg:svg> root xmlns', () => {
  it('L-4: memoryAdapter rejects .., ., and NUL bytes across methods and HTTP DELETE', async () => {
    const mem = createMemoryStorageAdapter();
    for (const bad of ['../../etc/passwd', '../a.png', './dot.png', 'a/./b.png', 'bad\0.png']) {
      await expect(mem.upload({ bucket: 'images', path: bad, data: Buffer.from('x'), contentType: 'image/png' })).rejects.toMatchObject({ status: 400 });
      await expect(mem.delete('images', bad)).rejects.toMatchObject({ status: 400 });
      await expect(mem.exists('images', bad)).rejects.toMatchObject({ status: 400 });
      await expect(mem.download('images', bad)).rejects.toMatchObject({ status: 400 });
    }
    const handler = createUploadHttpHandler({ uploader: createImageUploader({ storage: mem }) });
    const res = await handler.DELETE(new Request('http://localhost/api/upload?path=../../etc/passwd', { method: 'DELETE' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('L-5: canonicalizes <svg:svg xmlns:svg="..."> and ensures root <svg> has xmlns', async () => {
    const prefixed = '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><svg:rect width="80" height="40" fill="#2563eb"/></svg:svg>';
    const sanitizedPrefixed = sanitizeSvg(prefixed).toString('utf8');
    expect(sanitizedPrefixed).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><rect width="80" height="40" fill="#2563eb"/></svg>');
    const opt = await optimizeImage(Buffer.from(sanitizedPrefixed, 'utf8'));
    expect(opt.format).toBe('svg');
    expect(opt.width).toBe(80);
    expect(opt.height).toBe(40);

    const noXmlns = '<svg width="20" height="20"><svg width="10" height="10"><rect width="5" height="5"/></svg></svg>';
    expect(sanitizeSvg(noXmlns).toString('utf8')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><svg width="10" height="10"><rect width="5" height="5"/></svg></svg>',
    );
    expect(() => sanitizeSvg('<svg:svg xmlns:svg="http://evil.example/ns"><svg:rect/></svg:svg>')).toThrow(UploadValidationError);
  });
});
