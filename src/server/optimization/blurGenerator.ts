import { encode as encodeBlurHash } from 'blurhash';
import {
  blendEdgeColors,
  extractEdgeColorsFromBuffer,
} from './edgeColorExtractor';
import {
  BLUR_PLACEHOLDER_FALLBACK_WIDTH,
  BLUR_PLACEHOLDER_MAX_CHARS,
  BLUR_PLACEHOLDER_QUALITY,
  BLUR_PLACEHOLDER_WIDTH,
  type BlurHashResult,
  type GenerateBlurOptions,
} from './types';
import { loadLqip, loadSharp } from './loadSharp';

export async function encodeBlurHashString(
  buffer: Buffer,
  componentX: number = 4,
  componentY: number = 3,
): Promise<string> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(buffer)
    .resize(32, 32, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const clampedX = Math.max(1, Math.min(Math.round(componentX), info.width, 9));
  const clampedY = Math.max(1, Math.min(Math.round(componentY), info.height, 9));

  return encodeBlurHash(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    clampedX,
    clampedY,
  );
}

export async function generateBlurPlaceholder(
  buffer: Buffer,
  options: GenerateBlurOptions = {},
): Promise<BlurHashResult> {
  const targetWidth = options.width ?? BLUR_PLACEHOLDER_WIDTH;
  const fallbackWidth =
    options.fallbackWidth ?? BLUR_PLACEHOLDER_FALLBACK_WIDTH;
  const quality = options.quality ?? BLUR_PLACEHOLDER_QUALITY;
  const maxChars = options.maxDataUrlChars ?? BLUR_PLACEHOLDER_MAX_CHARS;
  const sharp = await loadSharp();
  const lqip = await loadLqip();

  try {
    let processBuffer = buffer;
    const isSvg = /<svg[\s>]/i.test(buffer.toString('utf8', 0, 1024));
    if (isSvg) {
      const normalizedSvg = buffer
        .toString('utf8')
        .replace(/<svg\b/gi, '<svg')
        .replace(/<\/svg\s*>/gi, '</svg>');
      processBuffer = await sharp(Buffer.from(normalizedSvg, 'utf8'))
        .resize(targetWidth, targetWidth, { fit: 'inside' })
        .png()
        .toBuffer();
    }

    const buildPlaceholder = (width: number, q: number) =>
      lqip(processBuffer, {
        outputFormat: 'webp',
        resize: width,
        outputOptions: { quality: q, effort: 6, smartSubsample: true },
      });

    let result = await buildPlaceholder(targetWidth, quality);
    if (result.metadata.dataURIBase64.length > maxChars) {
      result = await buildPlaceholder(fallbackWidth, quality);
    }

    const dataURL = result.metadata.dataURIBase64;
    const edgeColors = await extractEdgeColorsFromBuffer(processBuffer);
    const color = blendEdgeColors(edgeColors);

    let blurHash: string | undefined;
    if (options.includeBlurHash) {
      try {
        blurHash = await encodeBlurHashString(processBuffer);
      } catch {
        blurHash = undefined;
      }
    }

    return {
      dataURL,
      color,
      ...(blurHash && { blurHash }),
    };
  } catch {
    return generateFallbackBlur(buffer, options.includeBlurHash);
  }
}

export const generateBlurHash = generateBlurPlaceholder;

async function generateFallbackBlur(
  buffer: Buffer,
  includeBlurHash?: boolean,
): Promise<BlurHashResult> {
  const sharp = await loadSharp();
  const tinyBuffer = await sharp(buffer)
    .resize(64, 64, { fit: 'cover', kernel: 'lanczos3' })
    .blur(1.0)
    .webp({
      quality: 75,
      effort: 6,
      smartSubsample: false,
    })
    .toBuffer();

  const dataURL = `data:image/webp;base64,${tinyBuffer.toString('base64')}`;
  const edgeColors = await extractEdgeColorsFromBuffer(buffer);
  const color = blendEdgeColors(edgeColors);

  let blurHash: string | undefined;
  if (includeBlurHash) {
    try {
      blurHash = await encodeBlurHashString(tinyBuffer);
    } catch {
      blurHash = undefined;
    }
  }

  return { dataURL, color, ...(blurHash && { blurHash }) };
}
