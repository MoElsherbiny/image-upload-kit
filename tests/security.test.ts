import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineUploadPresets } from '../src';
import {
  createImageUploader,
  createUploadHttpHandler,
  UploadValidationError,
} from '../src/server';
import {
  createLocalFsStorageAdapter,
  createMemoryStorageAdapter,
} from '../src/storage';
import {
  decompressionBombPng,
  fixtureToFile,
  htmlDisguisedAsJpeg,
  maliciousSvg,
  solidImage,
  svgDisguisedAsPng,
  toFile,
} from './helpers/imageFixtures';

const UPLOAD_URL = 'http://localhost/api/upload';
const postForm = (handler: { POST: (r: Request) => Promise<Response> }, body: FormData, headers?: HeadersInit) =>
  handler.POST(new Request(UPLOAD_URL, { method: 'POST', headers, body }));

describe('Phase 3: Security Hardening', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects SVG payloads by default across standard presets', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const fixture = maliciousSvg();

    await expect(
      uploader.uploadImage(
        { buffer: fixture.buffer, name: fixture.name, type: fixture.mimeType },
        { preset: 'logo' },
      ),
    ).rejects.toThrow(UploadValidationError);
  });

  it('sanitizes malicious SVG when allowSvg: true is enabled', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, allowSvg: true });
    const fixture = maliciousSvg();

    const result = await uploader.uploadImage({
      buffer: fixture.buffer,
      name: fixture.name,
      type: fixture.mimeType,
    });

    expect(result.format).toBe('svg');
    const stored = storage.getObject('images', result.storagePath!);
    expect(stored).toBeDefined();
    const sanitizedText = Buffer.from(stored!.data).toString('utf8');

    expect(sanitizedText).not.toMatch(
      /<script|onload|onclick|foreignObject|<iframe|javascript:|evil\.example|<!DOCTYPE|<!ENTITY|&xxe;/i,
    );
    expect(sanitizedText).toContain('<rect');
  });

  it('rejects spoofed MIME types (SVG as image/png on avatar, HTML as JPEG)', async () => {
    const storage = createMemoryStorageAdapter();
    const handler = createUploadHttpHandler({ uploader: createImageUploader({ storage }) });

    const spoofedSvgForm = new FormData();
    spoofedSvgForm.append('file', fixtureToFile(svgDisguisedAsPng()));
    spoofedSvgForm.append('preset', 'avatar');
    expect((await postForm(handler, spoofedSvgForm)).status).toBe(400);

    const spoofedHtmlForm = new FormData();
    spoofedHtmlForm.append('file', fixtureToFile(htmlDisguisedAsJpeg()));
    expect((await postForm(handler, spoofedHtmlForm)).status).toBe(400);
  });

  it('ignores client customFilename by default; when allowed, forces output extension and never upserts', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const jpgBuf = await solidImage(120, 120, 'jpeg');
    const makeForm = (buf: Buffer) => {
      const f = new FormData();
      f.append('file', toFile(buf, 'pic.jpg', 'image/jpeg'));
      f.append('customFilename', '../../x.html');
      return f;
    };

    const defaultHandler = createUploadHttpHandler({ uploader });
    const res1 = await postForm(defaultHandler, makeForm(jpgBuf));
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as { storagePath: string };
    expect(data1.storagePath).not.toContain('x.html');
    expect(data1.storagePath).not.toBe('x.avif');

    const overrideHandler = createUploadHttpHandler({
      uploader,
      allowClientOverrides: { filename: true },
    });

    const firstRes = await postForm(overrideHandler, makeForm(jpgBuf));
    expect(firstRes.status).toBe(200);
    expect(((await firstRes.json()) as { storagePath: string }).storagePath).toBe('x.avif');

    const secondBuf = await solidImage(120, 120, 'jpeg', '#dd2244');
    const secondRes = await postForm(overrideHandler, makeForm(secondBuf));
    expect(secondRes.status).toBe(200);
    expect(((await secondRes.json()) as { storagePath: string }).storagePath).toMatch(/^x-[a-f0-9]+\.avif$/);
    expect(storage.getObject('images', 'x.avif')).toBeDefined();
  });

  it('rejects quality=0 and garbage quality with 400, and clamps client overrides to preset limits', async () => {
    const storage = createMemoryStorageAdapter();
    const handler = createUploadHttpHandler({
      uploader: createImageUploader({ storage }),
      allowClientOverrides: {
        dimensions: true,
        quality: true,
        folder: (f) => (f.startsWith('user-1/') ? f : null),
      },
    });
    const pngBuf = await solidImage(200, 200, 'png');

    for (const badQuality of ['0', 'abc', '-10', '101']) {
      const form = new FormData();
      form.append('file', toFile(pngBuf, 'a.png', 'image/png'));
      form.append('quality', badQuality);
      expect((await postForm(handler, form)).status).toBe(400);
    }

    const badFolderForm = new FormData();
    badFolderForm.append('file', toFile(pngBuf, 'a.png', 'image/png'));
    badFolderForm.append('folder', 'admin/secrets');
    expect((await postForm(handler, badFolderForm)).status).toBe(400);

    const bigBuf = await solidImage(800, 800, 'png');
    const clampForm = new FormData();
    clampForm.append('file', toFile(bigBuf, 'a.png', 'image/png'));
    clampForm.append('preset', 'avatar');
    clampForm.append('maxWidth', '4000');
    clampForm.append('maxHeight', '4000');
    clampForm.append('folder', 'user-1/pics');
    const clampRes = await postForm(handler, clampForm);
    expect(clampRes.status).toBe(200);
    const clamped = (await clampRes.json()) as { width: number; height: number; folder: string };
    expect(clamped.width).toBeLessThanOrEqual(512);
    expect(clamped.height).toBeLessThanOrEqual(512);
    expect(clamped.folder).toBe('user-1/pics');
  });

  it('returns 413 for oversized Content-Length and streamed bodies exceeding maxBodyBytes', async () => {
    const storage = createMemoryStorageAdapter();
    const handler = createUploadHttpHandler({
      uploader: createImageUploader({ storage }),
      maxBodyBytes: 512,
    });

    const clRes = await handler.POST(
      new Request(UPLOAD_URL, { method: 'POST', headers: { 'content-length': '2048' }, body: 'tiny' }),
    );
    expect(clRes.status).toBe(413);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(300));
        controller.enqueue(new Uint8Array(300));
        controller.close();
      },
    });
    const streamRes = await handler.POST(
      new Request(UPLOAD_URL, {
        method: 'POST',
        body: stream,
        // @ts-expect-error Node fetch duplex option for ReadableStream bodies
        duplex: 'half',
      }),
    );
    expect(streamRes.status).toBe(413);
  });

  it('enforces allowedOrigins (403), catches throwing authorize as 401, and blocks foreign-bucket DELETE (403)', async () => {
    const storage = createMemoryStorageAdapter({ baseUrl: 'https://cdn.test/uploads' });
    const uploader = createImageUploader({
      storage,
      defaultBucket: 'app-media',
      presets: defineUploadPresets({ avatar: { folder: 'avatars' } }),
    });

    const originHandler = createUploadHttpHandler({
      uploader,
      allowedOrigins: ['https://app.example.com'],
    });
    expect((await postForm(originHandler, new FormData(), { origin: 'https://evil.example.com' })).status).toBe(403);

    const throwingHandler = createUploadHttpHandler({
      uploader,
      authorize: () => {
        throw new Error('JWT expired');
      },
    });
    expect((await postForm(throwingHandler, new FormData())).status).toBe(401);

    const deleteHandler = createUploadHttpHandler({ uploader });
    const foreignDelRes = await deleteHandler.DELETE(
      new Request(
        `${UPLOAD_URL}?url=${encodeURIComponent('https://cdn.test/uploads/other-bucket/secret.avif')}`,
        { method: 'DELETE' },
      ),
    );
    expect(foreignDelRes.status).toBe(403);
  });

  it('never leaks internal error messages on 500 and invokes onError hook', async () => {
    const baseStorage = createMemoryStorageAdapter();
    const failingStorage = {
      ...baseStorage,
      async upload(): Promise<never> {
        throw new Error('FATAL: Postgres connection string postgres://secret@db/prod leaked');
      },
    };
    const onError = vi.fn();
    const handler = createUploadHttpHandler({
      uploader: createImageUploader({ storage: failingStorage }),
      onError,
    });

    const pngBuf = await solidImage(24, 24, 'png');
    const form = new FormData();
    form.append('file', toFile(pngBuf, 'ok.png', 'image/png'));
    const res = await postForm(handler, form);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: 'Internal server error' });
    expect(body.error).not.toContain('postgres://');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('rejects sibling-prefix traversal (uploads-old) and Windows drive segments in localFsAdapter', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-sec-'));
    tempDirs.push(tempRoot);

    const uploadsDir = path.join(tempRoot, 'uploads');
    const siblingDir = path.join(tempRoot, 'uploads-old');
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(siblingDir, { recursive: true });
    const siblingFile = path.join(siblingDir, 'keep.txt');
    await fs.writeFile(siblingFile, 'sensitive');

    const adapter = createLocalFsStorageAdapter({ rootDir: uploadsDir, baseUrl: '/uploads' });

    await expect(
      adapter.upload({ bucket: '../uploads-old', path: 'pwn.txt', data: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toThrow(/traversal|Invalid storage path/i);
    await expect(
      adapter.upload({ bucket: 'images', path: '../../uploads-old/pwn.txt', data: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toThrow(/traversal|Invalid storage path/i);
    await expect(
      adapter.upload({ bucket: 'C:', path: 'win.txt', data: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toThrow(/traversal|Invalid storage path/i);

    expect(await adapter.deleteByUrl('/uploads-old/keep.txt')).toBe(false);
    expect(await adapter.deleteByUrl('/uploads/../uploads-old/keep.txt')).toBe(false);
    expect(await fs.readFile(siblingFile, 'utf8')).toBe('sensitive');
  });

  it('rejects decompression-bomb PNG headers exceeding limitInputPixels', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage });
    const bomb = decompressionBombPng(50_000, 50_000);

    await expect(
      uploader.uploadImage({ buffer: bomb, name: 'bomb.png', type: 'image/png' }),
    ).rejects.toThrow(UploadValidationError);
  });
});
