import { encode as encodeBlurHash } from '../../blur/vendor/blurhash';
import {
  blendEdgeColors,
  computeEdgeColorSet,
  extractEdgeColorsFromBuffer,
} from './edgeColorExtractor';
import { loadSharp } from './loadSharp';
import {
  BLUR_PLACEHOLDER_FALLBACK_WIDTH,
  BLUR_PLACEHOLDER_MAX_CHARS,
  BLUR_PLACEHOLDER_QUALITY,
  BLUR_PLACEHOLDER_WIDTH,
  type BlurHashResult,
  type GenerateBlurOptions,
} from './types';

function encodeRawBlurHash(
  data: Buffer,
  width: number,
  height: number,
  componentX: number = 4,
  componentY: number = 3,
): string {
  const clampedX = Math.max(1, Math.min(Math.round(componentX), width, 9));
  const clampedY = Math.max(1, Math.min(Math.round(componentY), height, 9));
  return encodeBlurHash(
    new Uint8ClampedArray(data),
    width,
    height,
    clampedX,
    clampedY,
  );
}

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

  return encodeRawBlurHash(
    data,
    info.width,
    info.height,
    componentX,
    componentY,
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

  try {
    let processBuffer = buffer;
    const isSvg = /<svg[\s>]/i.test(buffer.toString('utf8', 0, 1024));
    if (isSvg) {
      const normalizedSvg = buffer
        .toString('utf8')
        .replace(/<svg\b/gi, '<svg')
        .replace(/<\/svg\s*>/gi, '</svg>');
      processBuffer = Buffer.from(normalizedSvg, 'utf8');
    }

    const baseSize = Math.max(targetWidth, 128);
    const rawSample = await sharp(processBuffer)
      .rotate()
      .resize(baseSize, baseSize, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rawInput = {
      raw: {
        width: rawSample.info.width,
        height: rawSample.info.height,
        channels: 4 as const,
      },
    };

    const buildPlaceholderDataUrl = async (width: number): Promise<string> => {
      const webpBuffer = await sharp(rawSample.data, rawInput)
        .resize(width, width, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 6, smartSubsample: true })
        .toBuffer();
      return `data:image/webp;base64,${webpBuffer.toString('base64')}`;
    };

    let dataURL = await buildPlaceholderDataUrl(targetWidth);
    if (dataURL.length > maxChars) {
      dataURL = await buildPlaceholderDataUrl(fallbackWidth);
    }

    const edgeColors = computeEdgeColorSet(
      rawSample.data,
      rawSample.info.width,
      rawSample.info.height,
    );
    const color = blendEdgeColors(edgeColors);

    let blurHash: string | undefined;
    if (options.includeBlurHash) {
      try {
        const hashSample =
          rawSample.info.width <= 32 && rawSample.info.height <= 32
            ? rawSample
            : await sharp(rawSample.data, rawInput)
                .resize(32, 32, { fit: 'inside' })
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
        blurHash = encodeRawBlurHash(
          hashSample.data,
          hashSample.info.width,
          hashSample.info.height,
        );
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
