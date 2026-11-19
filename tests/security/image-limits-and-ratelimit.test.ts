import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  assertImageMetadataLimits,
  createImageUploader,
  createMemoryRateLimiter,
  createUploadHttpHandler,
  sniffImageFormat,
} from '../../src/server';
import { createMemoryStorageAdapter } from '../../src/storage';
import { isUploadKitError, UploadKitError } from '../../src/types/errors';
import type { QuotaProvider } from '../../src/types/rateLimit';
import { toFile } from '../helpers/imageFixtures';

const SECRET = 'ratelimit-test-secret-key-2026';
let pngBuffer: Buffer;

beforeAll(async () => {
  pngBuffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 80, g: 140, b: 200 } },
  })
    .png()
    .toBuffer();
});

function uploadFormRequest(headers: Record<string, string> = {}): Request {
  const form = new FormData();
  form.append('file', toFile(pngBuffer, 'photo.png', 'image/png'));
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    headers,
    body: form,
  });
}

describe('Image resource limits & sniffing hardening', () => {
  it('enforces maxWidth, maxHeight, maxPixels, maxFrames and rejects invalid metadata', () => {
    expect(() =>
      assertImageMetadataLimits(
        { width: 800, height: 600, pages: 1 },
        { maxWidth: 1000, maxHeight: 1000, maxPixels: 1_000_000, maxFrames: 10 },
      ),
    ).not.toThrow();

    const invalidCases: Array<{
      meta: { width?: number; height?: number; pages?: number; frames?: number } | null;
      limits: { maxWidth?: number; maxHeight?: number; maxPixels?: number; maxFrames?: number };
      expectedCode: 'INVALID_IMAGE' | 'RESOURCE_LIMIT_EXCEEDED';
    }> = [
      { meta: null, limits: {}, expectedCode: 'INVALID_IMAGE' },
      { meta: { width: 0, height: 100 }, limits: {}, expectedCode: 'INVALID_IMAGE' },
      { meta: { width: 2001, height: 100 }, limits: { maxWidth: 2000 }, expectedCode: 'RESOURCE_LIMIT_EXCEEDED' },
      { meta: { width: 100, height: 2001 }, limits: { maxHeight: 2000 }, expectedCode: 'RESOURCE_LIMIT_EXCEEDED' },
      { meta: { width: 1000, height: 1000 }, limits: { maxPixels: 500_000 }, expectedCode: 'RESOURCE_LIMIT_EXCEEDED' },
      { meta: { width: 100, height: 100, pages: 25 }, limits: { maxFrames: 10 }, expectedCode: 'RESOURCE_LIMIT_EXCEEDED' },
      { meta: { width: 100, height: 100, frames: 12 }, limits: { maxFrames: 5 }, expectedCode: 'RESOURCE_LIMIT_EXCEEDED' },
    ];

    for (const c of invalidCases) {
      try {
        assertImageMetadataLimits(c.meta, c.limits);
        expect.unreachable('Expected assertImageMetadataLimits to throw');
      } catch (err) {
        expect(isUploadKitError(err)).toBe(true);
        if (isUploadKitError(err)) {
          expect(err.code).toBe(c.expectedCode);
        }
      }
    }
  });

  it('rejects truncated raster headers and HTML/PHP polyglots in sniffImageFormat', () => {
    // Valid PNG passes
    expect(sniffImageFormat(pngBuffer)?.format).toBe('png');
    // Truncated 8-byte PNG header without IHDR fails
    expect(sniffImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    // Truncated WebP without VP8 chunk fails
    expect(sniffImageFormat(Buffer.from('RIFF\x00\x00\x00\x00WEBP'))).toBeNull();
    // GIF + <script> polyglot fails
    expect(sniffImageFormat(Buffer.from('GIF89a<script>alert(1)</script>'))).toBeNull();
    // PHP + <svg> polyglot fails
    expect(sniffImageFormat(Buffer.from('<?php echo 1; ?><svg></svg>'))).toBeNull();
  });
});

describe('Rate limiting, quotas, and error redaction', () => {
  it('enforces 429 RATE_LIMITED with Retry-After across POST, presign, finalize, and DELETE', async () => {
    let now = 1_700_000_000_000;
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    const rateLimiter = createMemoryRateLimiter({
      limit: 1,
      windowMs: 10_000,
      now: () => now,
    });

    const handler = createUploadHttpHandler({
      uploader,
      getSubject: ({ request }) => request.headers.get('x-user') ?? undefined,
      rateLimiter,
      presigned: { secret: SECRET },
    });

    // POST upload: 1st allowed, 2nd rate-limited with 429 + Retry-After
    const first = await handler.POST(uploadFormRequest({ 'x-user': 'u1' }));
    expect(first.status).toBe(200);

    const second = await handler.POST(uploadFormRequest({ 'x-user': 'u1' }));
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    const secondBody = (await second.json()) as {
      error: string;
      code: string;
      retryable: boolean;
    };
    expect(secondBody.code).toBe('RATE_LIMITED');
    expect(secondBody.retryable).toBe(true);

    // Presign action has independent action bucket, also enforced
    const p1 = await handler.POST(
      new Request('http://localhost/api/upload?action=presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user': 'u1' },
        body: JSON.stringify({ filename: 'a.png', contentType: 'image/png', size: 100 }),
      }),
    );
    expect(p1.status).toBe(200);
    const p2 = await handler.POST(
      new Request('http://localhost/api/upload?action=presign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user': 'u1' },
        body: JSON.stringify({ filename: 'b.png', contentType: 'image/png', size: 100 }),
      }),
    );
    expect(p2.status).toBe(429);
    expect(p2.headers.get('Retry-After')).toBeTruthy();

    // DELETE is also rate-limited
    const d1 = await handler.DELETE(
      new Request('http://localhost/api/upload?path=missing.avif', {
        method: 'DELETE',
        headers: { 'x-user': 'u1' },
      }),
    );
    expect(d1.status).toBe(200);
    const d2 = await handler.DELETE(
      new Request('http://localhost/api/upload?path=missing.avif', {
        method: 'DELETE',
        headers: { 'x-user': 'u1' },
      }),
    );
    expect(d2.status).toBe(429);

    // After window elapses, requests are allowed again
    now += 10_001;
    const afterWindow = await handler.POST(uploadFormRequest({ 'x-user': 'u1' }));
    expect(afterWindow.status).toBe(200);
  });

  it('rejects uploads exceeding quotaProvider and records usage on success', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    let usedBytes = 0;
    const limitBytes = pngBuffer.byteLength + 10;
    const recordUsage = vi.fn(({ bytes }: { bytes: number }) => {
      usedBytes += bytes;
    });

    const quotaProvider: QuotaProvider = {
      check({ bytes }) {
        if (usedBytes + bytes > limitBytes) {
          return { allowed: false, reason: 'Monthly storage quota reached', retryAfterSeconds: 60 };
        }
        return { allowed: true };
      },
      recordUsage,
    };

    const handler = createUploadHttpHandler({
      uploader,
      getSubject: () => 'tenant-1',
      quotaProvider,
    });

    const okRes = await handler.POST(uploadFormRequest());
    expect(okRes.status).toBe(200);
    expect(recordUsage).toHaveBeenCalledTimes(1);

    const rejectedRes = await handler.POST(uploadFormRequest());
    expect(rejectedRes.status).toBe(429);
    expect(rejectedRes.headers.get('Retry-After')).toBe('60');
    const body = (await rejectedRes.json()) as { code: string; error: string };
    expect(body.code).toBe('RESOURCE_LIMIT_EXCEEDED');
    expect(body.error).toContain('Monthly storage quota reached');
  });

  it('never leaks internal UploadKitError cause or stack trace in HTTP responses', async () => {
    const baseUploader = createImageUploader({
      storage: createMemoryStorageAdapter(),
    });
    const failingUploader = {
      ...baseUploader,
      async uploadImage(): Promise<never> {
        throw new UploadKitError('Storage backend unavailable', {
          code: 'STORAGE_ERROR',
          status: 502,
          retryable: true,
          cause: new Error('AWS_SECRET_ACCESS_KEY=super-secret-leak'),
        });
      },
    };
    const onError = vi.fn();
    const handler = createUploadHttpHandler({
      uploader: failingUploader,
      onError,
    });

    const res = await handler.POST(uploadFormRequest());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(text).not.toContain('super-secret-leak');
    expect(text).not.toContain('cause');
    expect(text).not.toContain('stack');
    const parsed = JSON.parse(text) as { error: string; code: string; retryable: boolean };
    expect(parsed).toEqual({
      error: 'Storage backend unavailable',
      code: 'STORAGE_ERROR',
      retryable: true,
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
