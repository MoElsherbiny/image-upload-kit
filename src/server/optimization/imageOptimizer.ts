import sharp from 'sharp';
import { DEFAULT_IMAGE_DIMENSIONS } from '../../types';
import {
  type OptimizedImageResult,
  type OptimizeImageOptions,
  PRIMARY_AVIF_EFFORT,
  RETRY_AVIF_EFFORT,
} from './types';

export async function optimizeImage(
  buffer: Buffer,
  options: OptimizeImageOptions = {},
): Promise<OptimizedImageResult> {
  const maxDimensions = options.maxDimensions || DEFAULT_IMAGE_DIMENSIONS;
  const { outputFormat, quality } = options;

  let pipeline = sharp(buffer, {
    failOnError: false,
    limitInputPixels: 268402689,
  }).rotate();

  const metadata = await pipeline.metadata();
  const originalFormat = metadata.format;

  if (originalFormat === 'svg') {
    let width = metadata.width;
    let height = metadata.height;

    if (!width || !height) {
      const svgText = buffer.toString('utf8');
      const viewBoxMatch = svgText.match(
        /viewBox\s*=\s*["']\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*["']/i,
      );
      if (viewBoxMatch) {
        width = Math.round(parseFloat(viewBoxMatch[3]));
        height = Math.round(parseFloat(viewBoxMatch[4]));
      }
    }

    return {
      buffer,
      width: width || maxDimensions.width || 600,
      height: height || maxDimensions.height || 600,
      format: 'svg',
      size: buffer.length,
    };
  }

  const isPhoto =
    originalFormat === 'jpeg' ||
    Boolean(metadata.density && metadata.density > 150);

  let baseQuality = quality ?? (isPhoto ? 85 : 88);
  baseQuality = Math.max(1, Math.min(100, baseQuality));

  pipeline = pipeline.resize(maxDimensions.width, maxDimensions.height, {
    fit: 'inside',
    withoutEnlargement: true,
    kernel: 'lanczos3',
  });

  if (
    outputFormat === 'jpeg' ||
    outputFormat === 'png' ||
    outputFormat === 'webp'
  ) {
    let cloned = pipeline.clone();
    if (outputFormat === 'jpeg') {
      cloned = cloned.jpeg({ quality: baseQuality, mozjpeg: true });
    } else if (outputFormat === 'png') {
      cloned = cloned.png();
    } else if (outputFormat === 'webp') {
      cloned = cloned.webp({ quality: baseQuality, effort: 4 });
    }

    const outputBuffer = await cloned.toBuffer({ resolveWithObject: true });

    return {
      buffer: outputBuffer.data,
      width: outputBuffer.info.width || maxDimensions.width,
      height: outputBuffer.info.height || maxDimensions.height,
      format: outputFormat,
      size: outputBuffer.info.size,
    };
  }

  const avifBuffer = await pipeline
    .clone()
    .avif({
      quality: baseQuality,
      effort: PRIMARY_AVIF_EFFORT,
      chromaSubsampling: '4:2:0',
      bitdepth: 8,
    })
    .toBuffer({ resolveWithObject: true });

  // Size-guard against bloating previously low-Q JPEGs when re-encoded at high-Q AVIF
  const avifSize = avifBuffer.info.size;
  const originalSize = buffer.length;

  if (avifSize <= originalSize || outputFormat === 'avif') {
    const finalMetadata = await sharp(avifBuffer.data).metadata();
    return {
      buffer: avifBuffer.data,
      width: finalMetadata.width ?? maxDimensions.width,
      height: finalMetadata.height ?? maxDimensions.height,
      format: 'avif',
      size: avifSize,
    };
  }

  const scaledQuality = Math.max(
    40,
    Math.round(baseQuality * Math.sqrt(originalSize / avifSize)),
  );

  const avifRetry = await pipeline
    .clone()
    .avif({
      quality: scaledQuality,
      effort: RETRY_AVIF_EFFORT,
      chromaSubsampling: '4:2:0',
      bitdepth: 8,
    })
    .toBuffer({ resolveWithObject: true });

  if (avifRetry.info.size <= originalSize) {
    const retryMeta = await sharp(avifRetry.data).metadata();
    return {
      buffer: avifRetry.data,
      width: retryMeta.width ?? maxDimensions.width,
      height: retryMeta.height ?? maxDimensions.height,
      format: 'avif',
      size: avifRetry.info.size,
    };
  }

  const wasDimensionCapped =
    (metadata.width ?? 0) > maxDimensions.width ||
    (metadata.height ?? 0) > maxDimensions.height;

  if (!wasDimensionCapped) {
    const PASSTHROUGH_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);
    const srcFmt = PASSTHROUGH_FORMATS.has(originalFormat ?? '')
      ? (originalFormat as 'jpeg' | 'png' | 'webp' | 'avif')
      : 'jpeg';
    return {
      buffer,
      width: metadata.width ?? maxDimensions.width,
      height: metadata.height ?? maxDimensions.height,
      format: srcFmt,
      size: originalSize,
    };
  }

  const webpBuffer = await pipeline
    .clone()
    .webp({ quality: baseQuality, effort: 6, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  const useWebP = webpBuffer.info.size <= avifRetry.info.size;
  const winner = useWebP
    ? { buf: webpBuffer.data, fmt: 'webp' as const, sz: webpBuffer.info.size }
    : { buf: avifRetry.data, fmt: 'avif' as const, sz: avifRetry.info.size };

  const winnerMeta = await sharp(winner.buf).metadata();
  return {
    buffer: winner.buf,
    width: winnerMeta.width ?? maxDimensions.width,
    height: winnerMeta.height ?? maxDimensions.height,
    format: winner.fmt,
    size: winner.sz,
  };
}
