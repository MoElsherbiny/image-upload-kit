import { UploadValidationError } from '../handler/responses';

export type SniffedImageFormat =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'avif'
  | 'heif'
  | 'tiff'
  | 'bmp'
  | 'ico'
  | 'svg';

export interface SniffedFormatResult {
  format: SniffedImageFormat;
  mime: string;
}

const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  const limit = Math.min(bytes.length, end);
  for (let i = start; i < limit; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function sniffIsoBmff(bytes: Uint8Array): SniffedFormatResult | null {
  if (bytes.length < 12) return null;
  if (readAscii(bytes, 4, 8) !== 'ftyp') return null;

  const boxSize =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const maxOffset = Math.min(
    bytes.length,
    boxSize >= 16 ? Math.min(boxSize, 128) : 64,
  );

  const majorBrand = readAscii(bytes, 8, 12).toLowerCase();
  if (AVIF_BRANDS.has(majorBrand)) {
    return { format: 'avif', mime: 'image/avif' };
  }

  const brands = [majorBrand];
  for (let offset = 16; offset + 4 <= maxOffset; offset += 4) {
    brands.push(readAscii(bytes, offset, offset + 4).toLowerCase());
  }

  if (brands.some((b) => AVIF_BRANDS.has(b))) {
    return { format: 'avif', mime: 'image/avif' };
  }
  if (brands.some((b) => HEIF_BRANDS.has(b))) {
    return { format: 'heif', mime: 'image/heif' };
  }

  return null;
}

function sniffTextSvg(bytes: Uint8Array): SniffedFormatResult | null {
  const sampleLength = Math.min(bytes.length, 4096);
  // Reject binary payloads containing NUL bytes in the text header
  for (let i = 0; i < Math.min(sampleLength, 512); i++) {
    if (bytes[i] === 0x00) return null;
  }

  const text = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, sampleLength))
    .replace(/^\uFEFF/, '')
    .trimStart();

  if (!text.startsWith('<')) return null;

  // Strip XML prolog, comments, and DOCTYPE declarations before checking the root tag
  const stripped = text
    .replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/<!DOCTYPE\s+svg[\s\S]*?(?:\]>|>)\s*/i, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .trimStart();

  if (/^<svg[\s>/]/i.test(stripped) || /<svg[\s>/]/i.test(text)) {
    if (/^<!doctype\s+html\b/i.test(text) || /^<html[\s>]/i.test(stripped)) {
      return null;
    }
    return { format: 'svg', mime: 'image/svg+xml' };
  }

  return null;
}

/**
 * Inspects magic bytes of a buffer to determine its true image format,
 * independent of any client-supplied MIME type or file extension.
 */
export function sniffImageFormat(
  input: Buffer | Uint8Array,
): SniffedFormatResult | null {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input as ArrayBufferLike);
  if (bytes.length < 4) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: 'jpeg', mime: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { format: 'png', mime: 'image/png' };
  }

  // GIF: GIF87a or GIF89a
  if (bytes.length >= 6) {
    const header = readAscii(bytes, 0, 6);
    if (header === 'GIF87a' || header === 'GIF89a') {
      return { format: 'gif', mime: 'image/gif' };
    }
  }

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === 'RIFF' &&
    readAscii(bytes, 8, 12) === 'WEBP'
  ) {
    return { format: 'webp', mime: 'image/webp' };
  }

  // ISO BMFF (AVIF / HEIC / HEIF)
  const bmff = sniffIsoBmff(bytes);
  if (bmff) return bmff;

  // TIFF: II*\0 (little-endian) or MM\0* (big-endian)
  if (
    (bytes[0] === 0x49 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x2a &&
      bytes[3] === 0x00) ||
    (bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x2a)
  ) {
    return { format: 'tiff', mime: 'image/tiff' };
  }

  // BMP: BM
  if (bytes.length >= 14 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { format: 'bmp', mime: 'image/bmp' };
  }

  // ICO: 00 00 01 00
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return { format: 'ico', mime: 'image/x-icon' };
  }

  return sniffTextSvg(bytes);
}

export function assertMagicBytesAllowed(
  buffer: Buffer | Uint8Array,
  allowedFormats: string[],
  allowSvg: boolean = false,
): SniffedFormatResult {
  const sniffed = sniffImageFormat(buffer);
  if (!sniffed) {
    throw new UploadValidationError(
      'Unsupported image format: file content is not a recognized image',
    );
  }

  if (sniffed.format === 'svg' && !allowSvg) {
    throw new UploadValidationError(
      'File type image/svg+xml is not allowed unless allowSvg: true is set',
    );
  }

  if (allowedFormats.length > 0 && !allowedFormats.includes(sniffed.mime)) {
    throw new UploadValidationError(
      `File type ${sniffed.mime} is not allowed. Allowed: ${allowedFormats.join(', ')}`,
    );
  }

  return sniffed;
}
