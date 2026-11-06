import { describe, expect, it } from 'vitest';
import { defineUploadPresets, type ImageUploadRecord } from '../src';
import {
  AsyncSemaphore,
  createImageUploader,
  createUploadHttpHandler,
  withTimeout,
} from '../src/server';
import { createMemoryStorageAdapter } from '../src/storage';

const SAMPLE_SVG = Buffer.from(
  '<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="100" fill="#3B82F6"/></svg>',
  'utf8',
);

describe('AsyncSemaphore and withTimeout', () => {
  it('enforces maximum concurrency across parallel async tasks', async () => {
    expect(() => new AsyncSemaphore(0)).toThrow('concurrency must be >= 1');

    const semaphore = new AsyncSemaphore(2);
    let active = 0;
    let peak = 0;

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((id) =>
        semaphore.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 15));
          active -= 1;
          return id * 10;
        }),
      ),
    );

    expect(peak).toBe(2);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('resolves fast tasks and rejects tasks exceeding timeoutMs', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'QuickJob')).resolves.toBe('ok');

    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 80);
    });
    await expect(withTimeout(slow, 15, 'SlowJob')).rejects.toThrow(
      'SlowJob timed out after 15ms',
    );
  });
});

describe('createImageUploader', () => {
  it('uploads SVG buffers with custom presets, customFilename, record hooks, and deletion', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/storage' });
    const recorded: ImageUploadRecord[] = [];

    const presets = defineUploadPresets({
      brandBanner: {
        folder: 'banners',
        quality: 91,
        includeBlurHash: true,
        allowSvg: true,
      },
    });

    const uploader = createImageUploader({
      storage,
      defaultBucket: 'assets',
      presets,
      awaitRecordHook: true,
      onUploadRecord: async (record) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        recorded.push(record);
      },
    });

    const uploaded = await uploader.uploadImage(
      { buffer: SAMPLE_SVG, name: 'banner.svg', type: 'image/svg+xml' },
      {
        preset: 'brandBanner',
        customFilename: 'spring launch',
        altText: 'Spring launch banner',
      },
    );

    expect(uploaded.bucket).toBe('assets');
    expect(uploaded.storagePath).toBe('banners/spring-launch.svg');
    expect(uploaded.url).toBe('https://cdn.test/storage/assets/banners/spring-launch.svg');
    expect(uploaded.width).toBe(200);
    expect(uploaded.height).toBe(100);
    expect(uploaded.format).toBe('svg');
    expect(uploaded.blurDataUrl.startsWith('data:image/webp;base64,')).toBe(true);
    expect(uploaded.blurColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(typeof uploaded.blurHash).toBe('string');

    // awaitRecordHook: true ensures hook finished before uploadImage resolved
    expect(recorded).toHaveLength(1);
    expect(recorded[0].quality).toBe(91);
    expect(recorded[0].preset).toBe('brandBanner');

    await uploader.deleteImage(uploaded.storagePath!);
    expect(storage.getObject('assets', 'banners/spring-launch.svg')).toBeUndefined();

    const second = await uploader.uploadImage(
      { buffer: SAMPLE_SVG, type: 'image/svg+xml' },
      { preset: 'brandBanner' },
    );
    expect(await uploader.deleteByUrl(second.url)).toBe(true);
    expect(storage.getObject('assets', second.storagePath!)).toBeUndefined();
  });

  it('retries path generation automatically when a storage collision occurs', async () => {
    const storage = createMemoryStorageAdapter();
    await storage.upload({
      bucket: 'images',
      path: 'colliding.svg',
      data: SAMPLE_SVG,
      contentType: 'image/svg+xml',
    });

    let attempts = 0;
    const uploader = createImageUploader({
      storage,
      allowSvg: true,
      pathGenerator: (ctx) => {
        attempts += 1;
        const name = attempts === 1 ? 'colliding.svg' : 'retried-unique.svg';
        return { bucket: ctx.bucket, path: name, filename: name };
      },
    });

    const result = await uploader.uploadImage({
      buffer: SAMPLE_SVG,
      type: 'image/svg+xml',
    });

    expect(attempts).toBe(2);
    expect(result.storagePath).toBe('retried-unique.svg');
  });
});

describe('createUploadHttpHandler', () => {
  it('handles auth checks, preset allowlists, multipart POST uploads, and DELETE by url or path', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploader = createImageUploader({
      storage,
      defaultBucket: 'media',
      presets: defineUploadPresets({
        featureCard: { folder: 'cards', quality: 86, allowSvg: true },
      }),
    });

    const handler = createUploadHttpHandler({
      uploader,
      authorize: ({ request }) => request.headers.get('x-api-key') === 'valid-key',
      allowedPresets: ['featureCard'],
    });

    const buildPostRequest = (preset: string, apiKey?: string) => {
      const form = new FormData();
      form.append('file', new File([SAMPLE_SVG], 'card.svg', { type: 'image/svg+xml' }));
      form.append('preset', preset);
      form.append('altText', 'Feature card');
      return new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: apiKey ? { 'x-api-key': apiKey } : {},
        body: form,
      });
    };

    // 1. Unauthorized -> 401
    const unauthRes = await handler.POST(buildPostRequest('featureCard'));
    expect(unauthRes.status).toBe(401);

    // 2. Disallowed preset -> 400
    const badPresetRes = await handler.POST(buildPostRequest('hero', 'valid-key'));
    expect(badPresetRes.status).toBe(400);
    const badPresetBody = (await badPresetRes.json()) as { error: string };
    expect(badPresetBody.error).toContain('Invalid preset');

    // 3. Valid POST -> 200
    const postRes1 = await handler.POST(buildPostRequest('featureCard', 'valid-key'));
    expect(postRes1.status).toBe(200);
    const uploaded1 = (await postRes1.json()) as { url: string; storagePath: string; altText: string };
    expect(uploaded1.altText).toBe('Feature card');
    expect(storage.getObject('media', uploaded1.storagePath)).toBeDefined();

    // 4. DELETE by ?url=
    const delByUrlRes = await handler.DELETE(
      new Request(`http://localhost/api/upload?url=${encodeURIComponent(uploaded1.url)}`, {
        method: 'DELETE',
        headers: { 'x-api-key': 'valid-key' },
      }),
    );
    expect(delByUrlRes.status).toBe(200);
    expect(await delByUrlRes.json()).toEqual({ success: true });
    expect(storage.getObject('media', uploaded1.storagePath)).toBeUndefined();

    // 5. DELETE by ?path=
    const postRes2 = await handler.POST(buildPostRequest('featureCard', 'valid-key'));
    const uploaded2 = (await postRes2.json()) as { storagePath: string };
    const delByPathRes = await handler.DELETE(
      new Request(`http://localhost/api/upload?path=${encodeURIComponent(uploaded2.storagePath)}`, {
        method: 'DELETE',
        headers: { 'x-api-key': 'valid-key' },
      }),
    );
    expect(delByPathRes.status).toBe(200);
    expect(await delByPathRes.json()).toEqual({ success: true });
    expect(storage.getObject('media', uploaded2.storagePath)).toBeUndefined();
  });
});
