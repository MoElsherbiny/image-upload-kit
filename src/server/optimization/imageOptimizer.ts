import { createHash } from 'node:crypto';
import { DEFAULT_IMAGE_DIMENSIONS } from '../../types';
import { UploadValidationError } from '../handler/responses';
import { assertImageMetadataLimits } from '../security/imageLimits';
import { sanitizeSvg } from '../security/sanitizeSvg';
import { sniffImageFormat } from '../security/sniffFormat';
import { loadSharp } from './loadSharp';
import { buildResizePlan, needsAspectCrop } from './resizePlan';
import { buildTransformCacheKey } from './transformCache';
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
  return { width: width && width > 0 ? width : 600, height: height && height > 0 ? height : 600 };
}

function processSvgBuffer(
  buffer: Buffer,
  options: OptimizeImageOptions,
  limitInputPixels: number,
  metaWidth?: number,
  metaHeight?: number,
  pages?: number,
): OptimizedImageResult {
  const sanitizedBuffer = sanitizeSvg(
    buffer,
    options.customSanitizer ? { customSanitizer: options.customSanitizer } : undefined,
  );
  const dims = extractSvgDimensions(sanitizedBuffer.toString('utf8'), metaWidth, metaHeight);
  assertImageMetadataLimits(
    { width: dims.width, height: dims.height, pages: pages ?? 1 },
    {
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      maxPixels: limitInputPixels,
      maxFrames: options.maxFrames,
    },
  );
  return {
    buffer: sanitizedBuffer,
    width: dims.width,
    height: dims.height,
    format: 'svg',
    size: sanitizedBuffer.length,
    ...(options.quality !== undefined ? { quality: options.quality } : {}),
  };
}

export async function optimizeImage(
  buffer: Buffer,
  options: OptimizeImageOptions = {},
): Promise<OptimizedImageResult> {
  const maxDimensions = options.maxDimensions || DEFAULT_IMAGE_DIMENSIONS;
  const {
    outputFormat, quality, aspectRatio, crop, focalPoint, colorSpace, preserveMetadata, transformCache,
  } = options;
  const limitInputPixels = options.limitInputPixels ?? DEFAULT_LIMIT_INPUT_PIXELS;
  const primaryEffort = options.effort ?? PRIMARY_AVIF_EFFORT;
  const retryEffort =
    options.effort !== undefined ? Math.max(1, options.effort - 1) : RETRY_AVIF_EFFORT;

  // Sniff and sanitize SVG BEFORE calling Sharp so untrusted XML never hits libvips/librsvg
  if (sniffImageFormat(buffer)?.format === 'svg') {
    return processSvgBuffer(buffer, options, limitInputPixels);
  }

  const sharp = await loadSharp();
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
    return processSvgBuffer(buffer, options, limitInputPixels, metadata.width, metadata.height, metadata.pages);
  }

  const isRotated90 =
    typeof metadata.orientation === 'number' && metadata.orientation >= 5 && metadata.orientation <= 8;
  const orientedWidth = isRotated90 ? metadata.height : metadata.width;
  const orientedHeight = isRotated90 ? metadata.width : metadata.height;

  assertImageMetadataLimits(
    { width: orientedWidth, height: orientedHeight, pages: metadata.pages },
    { maxWidth: options.maxWidth, maxHeight: options.maxHeight, maxFrames: options.maxFrames },
  );

  const cacheKey = transformCache
    ? buildTransformCacheKey(
        options.contentHash ?? createHash('sha256').update(buffer).digest('hex'),
        options,
      )
    : undefined;
  if (transformCache && cacheKey) {
    const cached = await transformCache.get(cacheKey);
    if (cached) return cached;
  }

  const isPhoto = originalFormat === 'jpeg' || Boolean(metadata.density && metadata.density > 150);
  const baseQuality = Math.max(1, Math.min(100, quality ?? (isPhoto ? 85 : 88)));
  const resizePlan = buildResizePlan({
    width: orientedWidth, height: orientedHeight, maxDimensions, aspectRatio, crop, focalPoint,
  });

  if (resizePlan.fit === 'cover' && resizePlan.extract) {
    if (typeof metadata.orientation === 'number' && metadata.orientation > 1) {
      const rotated = await pipeline.toBuffer();
      pipeline = sharp(rotated, { failOn: 'error', limitInputPixels });
    }
    pipeline = pipeline
      .extract(resizePlan.extract)
      .resize(resizePlan.width, resizePlan.height, { fit: 'fill', kernel: 'lanczos3' });
  } else if (resizePlan.fit === 'cover') {
    pipeline = pipeline.resize(resizePlan.width, resizePlan.height, {
      fit: 'cover', position: resizePlan.position, kernel: 'lanczos3',
    });
  } else {
    pipeline = pipeline.resize(resizePlan.width, resizePlan.height, {
      fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3',
    });
  }

  if (colorSpace === 'srgb') pipeline = pipeline.toColorspace('srgb');
  if (preserveMetadata === true) pipeline = pipeline.withMetadata();

  const buildResult = (
    out: { data: Buffer; info: { width: number; height: number; size: number } },
    format: OptimizedImageResult['format'],
    q: number,
    fallbackW = resizePlan.width,
    fallbackH = resizePlan.height,
  ): OptimizedImageResult => ({
    buffer: out.data,
    width: out.info.width || fallbackW,
    height: out.info.height || fallbackH,
    format,
    size: out.info.size,
    quality: q,
  });

  const encodeRaster = async (): Promise<OptimizedImageResult> => {
    if (outputFormat === 'jpeg' || outputFormat === 'png' || outputFormat === 'webp') {
      let cloned = pipeline.clone();
      if (outputFormat === 'jpeg') cloned = cloned.jpeg({ quality: baseQuality, mozjpeg: true });
      else if (outputFormat === 'png') cloned = cloned.png();
      else cloned = cloned.webp({ quality: baseQuality, effort: 4 });
      return buildResult(await cloned.toBuffer({ resolveWithObject: true }), outputFormat, baseQuality);
    }

    const avifBuffer = await pipeline
      .clone()
      .avif({ quality: baseQuality, effort: primaryEffort, chromaSubsampling: '4:2:0', bitdepth: 8 })
      .toBuffer({ resolveWithObject: true });

    const avifSize = avifBuffer.info.size;
    const originalSize = buffer.length;
    if (avifSize <= originalSize || outputFormat === 'avif') {
      return buildResult(avifBuffer, 'avif', baseQuality);
    }

    const scaledQuality = Math.max(40, Math.round(baseQuality * Math.sqrt(originalSize / avifSize)));
    const avifRetry = await pipeline
      .clone()
      .avif({ quality: scaledQuality, effort: retryEffort, chromaSubsampling: '4:2:0', bitdepth: 8 })
      .toBuffer({ resolveWithObject: true });
    if (avifRetry.info.size <= originalSize) {
      return buildResult(avifRetry, 'avif', scaledQuality);
    }

    const wasDimensionCapped =
      (orientedWidth ?? 0) > maxDimensions.width || (orientedHeight ?? 0) > maxDimensions.height;
    const isCropRequired = needsAspectCrop(orientedWidth, orientedHeight, aspectRatio);
    if (!wasDimensionCapped && !isCropRequired && PASSTHROUGH_FORMATS.has(originalFormat ?? '')) {
      const srcFmt = originalFormat as 'jpeg' | 'png' | 'webp' | 'avif';
      let passthrough = pipeline.clone();
      if (srcFmt === 'jpeg') passthrough = passthrough.jpeg({ quality: baseQuality, mozjpeg: true });
      else if (srcFmt === 'png') passthrough = passthrough.png({ compressionLevel: 9 });
      else if (srcFmt === 'webp') passthrough = passthrough.webp({ quality: baseQuality, effort: 4 });
      else passthrough = passthrough.avif({ quality: baseQuality, effort: retryEffort });

      let passthroughOut = await passthrough.toBuffer({ resolveWithObject: true });
      let passthroughQuality = baseQuality;
      if (srcFmt === 'jpeg' && passthroughOut.info.size > originalSize) {
        const scaledQ = Math.max(40, Math.round(baseQuality * Math.sqrt(originalSize / passthroughOut.info.size)));
        const scaledOut = await pipeline.clone().jpeg({ quality: scaledQ, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        if (scaledOut.info.size <= originalSize) {
          passthroughOut = scaledOut;
          passthroughQuality = scaledQ;
        } else {
          const needsExifRotation = typeof metadata.orientation === 'number' && metadata.orientation > 1;
          const hasSensitiveMetadata = Boolean(metadata.exif || metadata.xmp || metadata.iptc || metadata.comments?.length);
          if (!needsExifRotation && (preserveMetadata === true || !hasSensitiveMetadata)) {
            return {
              buffer, width: orientedWidth || resizePlan.width, height: orientedHeight || resizePlan.height,
              format: 'jpeg', size: originalSize, quality: baseQuality,
            };
          }
          passthroughOut = await pipeline.clone().jpeg({ quality: 10, mozjpeg: true }).toBuffer({ resolveWithObject: true });
          passthroughQuality = 10;
        }
      }
      return buildResult(
        passthroughOut, srcFmt, passthroughQuality,
        orientedWidth || resizePlan.width, orientedHeight || resizePlan.height,
      );
    }

    const webpBuffer = await pipeline
      .clone()
      .webp({ quality: baseQuality, effort: 6, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });
    return webpBuffer.info.size <= avifRetry.info.size
      ? buildResult(webpBuffer, 'webp', baseQuality)
      : buildResult(avifRetry, 'avif', scaledQuality);
  };

  const result = await encodeRaster();
  if (transformCache && cacheKey) {
    await transformCache.set(cacheKey, result);
  }
  return result;
}
