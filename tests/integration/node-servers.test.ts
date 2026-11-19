import fs from 'node:fs/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createImageUploader,
  createMemoryRateLimiter,
  createUploadHttpHandler,
} from '../../src/server';
import { createLocalFsStorageAdapter, type StorageAdapter } from '../../src/storage';

const PRESIGN_SECRET = 'live-node-http-integration-secret-2026';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(req: IncomingMessage, baseUrl: string): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (typeof value === 'string') headers.set(key, value);
  }
  const method = (req.method ?? 'GET').toUpperCase();
  const body = method !== 'GET' && method !== 'HEAD' ? await readBody(req) : undefined;
  return new Request(new URL(req.url ?? '/', baseUrl), {
    method,
    headers,
    ...(body ? { body: new Uint8Array(body) } : {}),
  });
}

async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

function pngForm(pngBuffer: Buffer, filename: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(pngBuffer)], filename, { type: 'image/png' }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

describe('Live Node.js HTTP Server Integration (node:http + LocalFsStorageAdapter)', () => {
  let tempDir: string;
  let pngBuffer: Buffer;
  let server: Server;
  let baseUrl: string;
  let localFs: ReturnType<typeof createLocalFsStorageAdapter>;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-node-http-'));
    pngBuffer = await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 24, g: 144, b: 255 } },
    })
      .png()
      .toBuffer();

    localFs = createLocalFsStorageAdapter({ rootDir: tempDir, baseUrl: '/uploads' });

    let serverBaseUrl = '';
    const storageWithPresign: StorageAdapter = {
      ...localFs,
      async createPresignedUpload({ bucket, path: stagingPath, contentType }) {
        return {
          method: 'PUT',
          url: `${serverBaseUrl}/presigned-put/${encodeURIComponent(bucket)}/${stagingPath}`,
          headers: { 'content-type': contentType },
        };
      },
    };

    const uploader = createImageUploader({ storage: storageWithPresign, defaultBucket: 'media' });
    const svgUploader = createImageUploader({
      storage: localFs,
      defaultBucket: 'media',
      presets: {
        svgAllowed: { maxSizeMB: 2, allowSvg: true, allowedFormats: ['image/svg+xml', 'image/png'] },
      },
    });

    const mainHandler = createUploadHttpHandler({
      uploader,
      authorize: ({ action, request }) =>
        action === 'delete' ? request.headers.get('x-owner-token') === 'owner-ok' : true,
      getSubject: ({ request }) => request.headers.get('x-user-id') ?? undefined,
      presigned: { secret: PRESIGN_SECRET, stagingPrefix: '_staging/' },
      allowClientOverrides: { folder: true },
    });
    const svgHandler = createUploadHttpHandler({ uploader: svgUploader });
    const rateLimitedHandler = createUploadHttpHandler({
      uploader,
      getSubject: ({ request }) => request.headers.get('x-user-id') ?? 'anon',
      rateLimiter: createMemoryRateLimiter({ limit: 1, windowMs: 30_000 }),
    });

    server = http.createServer((req, res) => {
      void (async () => {
        const urlObj = new URL(req.url ?? '/', serverBaseUrl || 'http://127.0.0.1');
        if (req.method === 'PUT' && urlObj.pathname.startsWith('/presigned-put/')) {
          const rest = urlObj.pathname.slice('/presigned-put/'.length);
          const slashIdx = rest.indexOf('/');
          await localFs.upload({
            bucket: decodeURIComponent(rest.slice(0, slashIdx)),
            path: rest.slice(slashIdx + 1),
            data: await readBody(req),
            contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
          });
          res.statusCode = 200;
          res.end('ok');
          return;
        }
        const webReq = await toWebRequest(req, serverBaseUrl);
        if (urlObj.pathname === '/api/upload') {
          const webRes =
            req.method === 'DELETE'
              ? await mainHandler.DELETE(webReq)
              : await mainHandler.POST(webReq);
          await writeWebResponse(res, webRes);
        } else if (urlObj.pathname === '/api/upload-svg') {
          await writeWebResponse(res, await svgHandler.POST(webReq));
        } else if (urlObj.pathname === '/api/upload-limited') {
          await writeWebResponse(res, await rateLimitedHandler.POST(webReq));
        } else {
          res.statusCode = 404;
          res.end('Not found');
        }
      })().catch((err: unknown) => {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : 'Internal error');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    serverBaseUrl = baseUrl;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('handles direct POST multipart upload over real HTTP and writes optimized asset to disk', async () => {
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      body: pngForm(pngBuffer, 'hero.png', { altText: 'Live HTTP image' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      storagePath: string;
      altText: string;
      width: number;
      height: number;
    };
    expect(body.altText).toBe('Live HTTP image');
    expect(body.width).toBe(120);
    expect(body.height).toBe(80);
    expect(await localFs.exists('media', body.storagePath)).toBe(true);
  });

  it('completes presign -> HTTP PUT -> finalize with getSubject ownership binding', async () => {
    const presignRes = await fetch(`${baseUrl}/api/upload?action=presign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'alice' },
      body: JSON.stringify({
        filename: 'avatar.png',
        contentType: 'image/png',
        size: pngBuffer.byteLength,
        preset: 'card',
      }),
    });
    expect(presignRes.status).toBe(200);
    const presigned = (await presignRes.json()) as {
      upload: { method: string; url: string; headers?: Record<string, string> };
      token: string;
      bucket: string;
      path: string;
    };

    const putRes = await fetch(presigned.upload.url, {
      method: presigned.upload.method,
      headers: presigned.upload.headers,
      body: new Uint8Array(pngBuffer),
    });
    expect(putRes.status).toBe(200);
    expect(await localFs.exists(presigned.bucket, presigned.path)).toBe(true);

    // Different subject must be rejected with 403 without consuming the token
    const wrongUserRes = await fetch(`${baseUrl}/api/upload?action=finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'bob' },
      body: JSON.stringify({ token: presigned.token }),
    });
    expect(wrongUserRes.status).toBe(403);

    // Original subject finalizes cleanly and removes staged object
    const okRes = await fetch(`${baseUrl}/api/upload?action=finalize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'alice' },
      body: JSON.stringify({ token: presigned.token, altText: 'Owned by Alice' }),
    });
    expect(okRes.status).toBe(200);
    const finalized = (await okRes.json()) as { storagePath: string; altText: string };
    expect(finalized.altText).toBe('Owned by Alice');
    expect(await localFs.exists('media', finalized.storagePath)).toBe(true);
    expect(await localFs.exists(presigned.bucket, presigned.path)).toBe(false);
  });

  it('enforces DELETE authorize ownership check (401 unauthorized, 200 authorized)', async () => {
    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      body: pngForm(pngBuffer, 'del.png'),
    });
    const uploaded = (await uploadRes.json()) as { storagePath: string };

    const unauth = await fetch(
      `${baseUrl}/api/upload?path=${encodeURIComponent(uploaded.storagePath)}`,
      { method: 'DELETE' },
    );
    expect(unauth.status).toBe(401);
    expect(await localFs.exists('media', uploaded.storagePath)).toBe(true);

    const auth = await fetch(
      `${baseUrl}/api/upload?path=${encodeURIComponent(uploaded.storagePath)}`,
      { method: 'DELETE', headers: { 'x-owner-token': 'owner-ok' } },
    );
    expect(auth.status).toBe(200);
    expect(await localFs.exists('media', uploaded.storagePath)).toBe(false);
  });

  it('enforces 429 RATE_LIMITED with Retry-After header over live HTTP', async () => {
    const first = await fetch(`${baseUrl}/api/upload-limited`, {
      method: 'POST',
      headers: { 'x-user-id': 'rl-user' },
      body: pngForm(pngBuffer, 'rl.png'),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/upload-limited`, {
      method: 'POST',
      headers: { 'x-user-id': 'rl-user' },
      body: pngForm(pngBuffer, 'rl.png'),
    });
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    const body = (await second.json()) as { code: string; retryable: boolean };
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.retryable).toBe(true);
  });

  it('rejects SVG by default (400) and sanitizes SVG when allowSvg: true', async () => {
    const dirtySvg =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10"/></svg>';

    const formDefault = new FormData();
    formDefault.append('file', new File([dirtySvg], 'icon.svg', { type: 'image/svg+xml' }));
    const rejected = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: formDefault });
    expect(rejected.status).toBe(400);

    const formAllowed = new FormData();
    formAllowed.append('file', new File([dirtySvg], 'icon.svg', { type: 'image/svg+xml' }));
    formAllowed.append('preset', 'svgAllowed');
    const accepted = await fetch(`${baseUrl}/api/upload-svg`, { method: 'POST', body: formAllowed });
    expect(accepted.status).toBe(200);
    const uploaded = (await accepted.json()) as { storagePath: string };
    const storedSvg = Buffer.from(await localFs.download('media', uploaded.storagePath)).toString('utf8');
    expect(storedSvg).toContain('<rect');
    expect(storedSvg).not.toContain('<script');
    expect(storedSvg).not.toContain('onload');
  });

  it('blocks path traversal attempts on DELETE', async () => {
    const res = await fetch(`${baseUrl}/api/upload?path=../../etc/passwd`, {
      method: 'DELETE',
      headers: { 'x-owner-token': 'owner-ok' },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(200);
  });
});
