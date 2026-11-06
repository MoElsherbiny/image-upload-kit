/**
 * Image fixtures for server/security tests. Raster fixtures are generated
 * with `sharp` on demand (and memoised); hostile payloads are hand-written.
 */
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';

export interface UploadFixture {
  buffer: Buffer;
  /** Client-declared MIME type (may lie on purpose). */
  mimeType: string;
  name: string;
}

const memo = new Map<string, Promise<Buffer>>();
function memoise(key: string, build: () => Promise<Buffer>): Promise<Buffer> {
  if (!memo.has(key)) memo.set(key, build());
  return memo.get(key)!;
}

/** Solid-color raster of the given size. */
export function solidImage(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png',
  background = '#3366cc',
): Promise<Buffer> {
  return memoise(`solid:${width}x${height}:${format}:${background}`, () =>
    sharp({ create: { width, height, channels: 3, background } })
      .toFormat(format)
      .toBuffer(),
  );
}

/**
 * 40×20 (stored) image tagged with EXIF orientation 6 (rotate 90° CW), so
 * the *displayed* size is 20×40. Left half red, right half blue.
 */
export function exifOrientation6(format: 'png' | 'jpeg' = 'jpeg'): Promise<Buffer> {
  return memoise(`exif6:${format}`, async () => {
    const left = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    return sharp({
      create: { width: 40, height: 20, channels: 3, background: '#0000ff' },
    })
      .composite([{ input: left, left: 0, top: 0 }])
      .withMetadata({ orientation: 6 })
      .toFormat(format)
      .toBuffer();
  });
}

/** Small static GIF (never a valid "jpeg" output label). */
export function gifImage(): Promise<Buffer> {
  return solidImage(24, 16, 'gif', '#22aa44');
}

/** SVG exercising every common XSS vector the sanitizer must strip. */
export const MALICIOUS_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="64" height="64" viewBox="0 0 64 64" onload="alert('onload')">
  <script type="text/javascript">alert('script')</script>
  <rect width="64" height="64" fill="#ff0066" onclick="alert('click')"/>
  <a xlink:href="javascript:alert('xlink')"><circle cx="32" cy="32" r="8"/></a>
  <a href="javascript:alert('href')"><circle cx="16" cy="16" r="4"/></a>
  <foreignObject width="64" height="64">
    <iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert('iframe')"></iframe>
  </foreignObject>
  <image href="https://evil.example/track.png" width="1" height="1"/>
  <text x="4" y="60">&xxe;</text>
</svg>
`;

/** Minimal benign SVG. */
export const SAFE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#00aa55"/></svg>`;

export function maliciousSvg(): UploadFixture {
  return {
    buffer: Buffer.from(MALICIOUS_SVG, 'utf8'),
    mimeType: 'image/svg+xml',
    name: 'evil.svg',
  };
}

/** SVG bytes that *claim* to be a PNG (content-type + extension lie). */
export function svgDisguisedAsPng(): UploadFixture {
  return {
    buffer: Buffer.from(MALICIOUS_SVG, 'utf8'),
    mimeType: 'image/png',
    name: 'innocent.png',
  };
}

/** HTML document labelled as JPEG. */
export function htmlDisguisedAsJpeg(): UploadFixture {
  return {
    buffer: Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8'),
    mimeType: 'image/jpeg',
    name: 'photo.jpg',
  };
}

// ----------------------------------------------------------- PNG crafting

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * A tiny (<100 B) PNG whose IHDR declares `width × height` pixels (default
 * 50 000 × 50 000 = 2.5 GP). Decoders that trust the header without a pixel
 * limit will try to allocate gigabytes — a decompression-bomb probe.
 */
export function decompressionBombPng(width = 50_000, height = 50_000): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type: truecolor
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace
  const idat = deflateSync(Buffer.alloc(16));
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Wraps a buffer in a `File` (uses the global File polyfilled in tests/setup.ts). */
export function toFile(
  buffer: Buffer,
  name: string,
  mimeType: string,
): File {
  return new File([new Uint8Array(buffer)], name, { type: mimeType });
}

export function fixtureToFile(fixture: UploadFixture): File {
  return toFile(fixture.buffer, fixture.name, fixture.mimeType);
}
