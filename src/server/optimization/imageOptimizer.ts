import { DEFAULT_IMAGE_DIMENSIONS } from '../../types';
import { UploadValidationError } from '../handler/responses';
import { sanitizeSvg } from '../security/sanitizeSvg';
import { loadSharp } from './loadSharp';
import { buildResizePlan, needsAspectCrop } from './resizePlan';
import {
  DEFAULT_LIMIT_INPUT_PIXELS,
  type OptimizedImageResult,
  type OptimizeImageOptions,
  PRIMARY_AVIF_EFFORT,
  RETRY_AVIF_EFFORT,
} from './types';

const PASSTHROUGH_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);

function extractSvgDimensions(
  svgText: string,
  metaWidth?: number,
  metaHeight?: number,
): { width: number; height: number } {
  let width = metaWidth;
  let height = metaHeight;

  if (!width || !height) {
    const svgTagMatch = svgText.match(/<svg\b[^>]*>/i);
    if (svgTagMatch) {
      const tag = svgTagMatch[0];
      const wMatch = tag.match(/\bwidth\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i);
      const hMatch = tag.match(/\bheight\s*=\s*["']\s*([\d.]+)(?:px)?\s*["']/i);
      if (!width && wMatch) width = Math.round(parseFloat(wMatch[1]));
      if (!height && hMatch) height = Math.round(parseFloat(hMatch[1]));
    }
  }

  if (!width || !height) {
    const viewBoxMatch = svgText.match(
      /viewBox\s*=\s*["']\s*([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)\s*["']/i,
    );
    if (viewBoxMatch) {
      if (!width) width = Math.round(parseFloat(viewBoxMatch[3]));
      if (!height) height = Math.round(parseFloat(viewBoxMatch[4]));
    }
  }

  return {
    width: width && width > 0 ? width : 600,
    height: height && height > 0 ? height : 600,
  };
}

export async function optimizeImage(
  buffer: Buffer,
  options: OptimizeImageOptions = {},
): Promise<OptimizedImageResult> {
  const sharp = await loadSharp();
  const maxDimensions = options.maxDimensions || DEFAULT_IMAGE_DIMENSIONS;
  const { outputFormat, quality, aspectRatio, crop } = options;
  const limitInputPixels = options.limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS;
  const primaryEffort = options.effort ?? PRIMARY_AVIF_EFFORT;
  const retryEffort =
    options.effort !== undefined ? Math.max(1, options.effort - 1) : RETRY_AVIF_EFFORT;

  let pipeline = sharp(buffer, { failOn: 'error', limitInputPixels }).rotate();

  let metadata;
  try {
    metadata = await pipeline.metadata();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes('pixel limit') || lower.includes('exceeds') || lower.includes('unsupported image format')) {
      throw new UploadValidationError(msg);
    }
    throw err;
  }
  const originalFormat = metadata.format;

  if (originalFormat === 'svg') {
    const sanitizedBuffer = sanitizeSvg(buffer);
    const dims = extractSvgDimensions(sanitizedBuffer.toString('utf8'), metadata.width, metadata.height);
    return {
      buffer: sanitizedBuffer,
      width: dims.width,
      height: dims.height,
      format: 'svg',
      size: sanitizedBuffer.length,
      ...(quality !== undefined ? { quality } : {}),
    };
  }

  const isRotated90 =
    typeof metadata.orientation === 'number' &&
    metadata.orientation >= 5 &&
    metadata.orientation <= 8;
  const orientedWidth = isRotated90 ? metadata.height : metadata.width;
  const orientedHeight = isRotated90 ? metadata.width : metadata.height;

  const isPhoto = originalFormat === 'jpeg' || Boolean(metadata.density && metadata.density > 150);
  const baseQuality = Math.max(1, Math.min(100, quality ?? (isPhoto ? 85 : 88)));

  const resizePlan = buildResizePlan({
    width: orientedWidth,
    height: orientedHeight,
    maxDimensions,
    aspectRatio,
    crop,
  });

  pipeline =
    resizePlan.fit === 'cover'
      ? pipeline.resize(resizePlan.width, resizePlan.height, {
          fit: 'cover',
          position: resizePlan.position,
          kernel: 'lanczos3',
        })
      : pipeline.resize(resizePlan.width, resizePlan.height, {
          fit: 'inside',
          withoutEnlargement: true,
          kernel: 'lanczos3',
        });

  if (outputFormat === 'jpeg' || outputFormat === 'png' || outputFormat === 'webp') {
    let cloned = pipeline.clone();
    if (outputFormat === 'jpeg') cloned = cloned.jpeg({ quality: baseQuality, mozjpeg: true });
    else if (outputFormat === 'png') cloned = cloned.png();
    else cloned = cloned.webp({ quality: baseQuality, effort: 4 });

    const outputBuffer = await cloned.toBuffer({ resolveWithObject: true });
    return {
      buffer: outputBuffer.data,
      width: outputBuffer.info.width || resizePlan.width,
      height: outputBuffer.info.height || resizePlan.height,
      format: outputFormat,
      size: outputBuffer.info.size,
      quality: baseQuality,
    };
  }

  const avifBuffer = await pipeline
    .clone()
    .avif({ quality: baseQuality, effort: primaryEffort, chromaSubsampling: '4:2:0', bitdepth: 8 })
    .toBuffer({ resolveWithObject: true });

  const avifSize = avifBuffer.info.size;
  const originalSize = buffer.length;

  if (avifSize <= originalSize || outputFormat === 'avif') {
    return {
      buffer: avifBuffer.data,
      width: avifBuffer.info.width || resizePlan.width,
      height: avifBuffer.info.height || resizePlan.height,
      format: 'avif',
      size: avifSize,
      quality: baseQuality,
    };
  }

  const scaledQuality = Math.max(40, Math.round(baseQuality * Math.sqrt(originalSize / avifSize)));

  const avifRetry = await pipeline
    .clone()
    .avif({ quality: scaledQuality, effort: retryEffort, chromaSubsampling: '4:2:0', bitdepth: 8 })
    .toBuffer({ resolveWithObject: true });

  if (avifRetry.info.size <= originalSize) {
    return {
      buffer: avifRetry.data,
      width: avifRetry.info.width || resizePlan.width,
      height: avifRetry.info.height || resizePlan.height,
      format: 'avif',
      size: avifRetry.info.size,
      quality: scaledQuality,
    };
  }

  const wasDimensionCapped =
    (orientedWidth ?? 0) > maxDimensions.width || (orientedHeight ?? 0) > maxDimensions.height;
  const isCropRequired = needsAspectCrop(orientedWidth, orientedHeight, aspectRatio);
  const isPassthroughCandidate =
    !wasDimensionCapped && !isCropRequired && PASSTHROUGH_FORMATS.has(originalFormat ?? '');

  if (isPassthroughCandidate) {
    const srcFmt = originalFormat as 'jpeg' | 'png' | 'webp' | 'avif';
    let passthrough = pipeline.clone();
    if (srcFmt === 'jpeg') passthrough = passthrough.jpeg({ quality: baseQuality, mozjpeg: true });
    else if (srcFmt === 'png') passthrough = passthrough.png({ compressionLevel: 9 });
    else if (srcFmt === 'webp') passthrough = passthrough.webp({ quality: baseQuality, effort: 4 });
    else passthrough = passthrough.avif({ quality: baseQuality, effort: retryEffort });

    let passthroughOut = await passthrough.toBuffer({ resolveWithObject: true });
    if (srcFmt === 'jpeg' && passthroughOut.info.size > originalSize) {
      passthroughOut = await pipeline.clone().jpeg({ quality: 10 }).toBuffer({ resolveWithObject: true });
    }

    return {
      buffer: passthroughOut.data,
      width: passthroughOut.info.width || orientedWidth || resizePlan.width,
      height: passthroughOut.info.height || orientedHeight || resizePlan.height,
      format: srcFmt,
      size: passthroughOut.info.size,
      quality: baseQuality,
    };
  }

  const webpBuffer = await pipeline
    .clone()
    .webp({ quality: baseQuality, effort: 6, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  const useWebP = webpBuffer.info.size <= avifRetry.info.size;
  const winner = useWebP
    ? { buf: webpBuffer.data, fmt: 'webp' as const, sz: webpBuffer.info.size, w: webpBuffer.info.width, h: webpBuffer.info.height, q: baseQuality }
    : { buf: avifRetry.data, fmt: 'avif' as const, sz: avifRetry.info.size, w: avifRetry.info.width, h: avifRetry.info.height, q: scaledQuality };

  return {
    buffer: winner.buf,
    width: winner.w || resizePlan.width,
    height: winner.h || resizePlan.height,
    format: winner.fmt,
    size: winner.sz,
    quality: winner.q,
  };
}
