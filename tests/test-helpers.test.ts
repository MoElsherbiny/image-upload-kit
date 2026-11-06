import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  decompressionBombPng,
  exifOrientation6,
  gifImage,
  MALICIOUS_SVG,
  maliciousSvg,
  svgDisguisedAsPng,
  toFile,
} from './helpers/imageFixtures';
import { installMockXhr } from './helpers/mockXhr';

describe('test helpers: imageFixtures', () => {
  it('exifOrientation6 carries orientation 6 with stored 40×20 pixels', async () => {
    const meta = await sharp(await exifOrientation6('jpeg')).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.orientation).toBe(6);
    expect([meta.width, meta.height]).toEqual([40, 20]);
  });

  it('exifOrientation6 can also be produced as PNG', async () => {
    const meta = await sharp(await exifOrientation6('png')).metadata();
    expect(meta.format).toBe('png');
    expect([meta.width, meta.height]).toEqual([40, 20]);
  });

  it('gifImage is a real GIF', async () => {
    const meta = await sharp(await gifImage()).metadata();
    expect(meta.format).toBe('gif');
  });

  it('malicious SVG contains every XSS vector', () => {
    for (const vector of ['<script', 'onload=', '<foreignObject', 'javascript:', '<!ENTITY']) {
      expect(MALICIOUS_SVG).toContain(vector);
    }
    expect(maliciousSvg().mimeType).toBe('image/svg+xml');
    const disguised = svgDisguisedAsPng();
    expect(disguised.mimeType).toBe('image/png');
    expect(disguised.buffer.toString('utf8')).toContain('<svg');
  });

  it('decompressionBombPng is tiny but declares 2.5 gigapixels', async () => {
    const bomb = decompressionBombPng();
    expect(bomb.length).toBeLessThan(200);
    const meta = await sharp(bomb, { limitInputPixels: false }).metadata();
    expect([meta.width, meta.height]).toEqual([50_000, 50_000]);
    await expect(sharp(bomb).toBuffer()).rejects.toThrow();
  });

  it('toFile wraps bytes in a File with the declared type', () => {
    const file = toFile(Buffer.from('abc'), 'a.png', 'image/png');
    expect(file.name).toBe('a.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(3);
  });
});

describe('test helpers: mockXhr', () => {
  it('drives progress, success and listener dispatch', () => {
    const controller = installMockXhr();
    try {
      const xhr = new XMLHttpRequest();
      const onProgress = vi.fn();
      const onLoad = vi.fn();
      xhr.upload.onprogress = onProgress;
      xhr.addEventListener('load', onLoad);
      xhr.open('POST', '/upload');
      xhr.setRequestHeader('X-Test', '1');
      xhr.send('body');

      const mock = controller.latest();
      expect(controller.pending()).toEqual([mock]);
      expect(mock.requestHeaders).toEqual({ 'X-Test': '1' });

      mock.progress(25, 100);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ lengthComputable: true, loaded: 25, total: 100 }),
      );

      mock.respond(201, { ok: true }, { 'Content-Type': 'application/json' });
      expect(onLoad).toHaveBeenCalledTimes(1);
      expect(xhr.status).toBe(201);
      expect(JSON.parse(xhr.responseText)).toEqual({ ok: true });
      expect(xhr.getResponseHeader('content-type')).toBe('application/json');
      expect(controller.pending()).toEqual([]);
      expect(() => mock.respond(200)).toThrow(/after completion/);
    } finally {
      controller.restore();
    }
  });

  it('supports abort() and network errors', () => {
    const controller = installMockXhr();
    try {
      const aborted = new XMLHttpRequest();
      const onAbort = vi.fn();
      aborted.onabort = onAbort;
      aborted.open('POST', '/a');
      aborted.send();
      aborted.abort();
      expect(onAbort).toHaveBeenCalledTimes(1);
      expect(controller.instances[0].aborted).toBe(true);

      const failing = new XMLHttpRequest();
      const onError = vi.fn();
      failing.onerror = onError;
      failing.open('POST', '/b');
      failing.send();
      controller.latest().networkError();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(failing.status).toBe(0);
    } finally {
      controller.restore();
    }
    expect(globalThis.XMLHttpRequest).toBeUndefined();
  });
});
