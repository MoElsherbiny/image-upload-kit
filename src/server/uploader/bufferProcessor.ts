import crypto from 'node:crypto';
import { generateBlurPlaceholder, optimizeImage } from '../optimization';
import { withTimeout } from '../semaphore';
import type {
  ProcessedImageBufferResult,
  ProcessImageBufferOptions,
} from './types';

export async function processImageBuffer(
  originalBuffer: Buffer,
  options: ProcessImageBufferOptions = {},
): Promise<ProcessedImageBufferResult> {
  const optTimeout = options.optimizationTimeoutMs ?? 60000;
  const blurTimeout = options.blurTimeoutMs ?? 30000;

  const contentHash = crypto
    .createHash('sha256')
    .update(originalBuffer)
    .digest('hex');

  const optimized = await withTimeout(
    optimizeImage(originalBuffer, {
      maxDimensions: options.maxDimensions,
      outputFormat: options.outputFormat,
      quality: options.quality,
    }),
    optTimeout,
    'Image optimization',
  );

  if (!optimized || !optimized.buffer) {
    throw new Error('Image optimization returned invalid result');
  }

  if (!optimized.width || !optimized.height) {
    throw new Error(
      `Image dimensions missing: width=${optimized.width}, height=${optimized.height}`,
    );
  }

  const blurData = await withTimeout(
    generateBlurPlaceholder(optimized.buffer, {
      includeBlurHash: options.includeBlurHash,
    }),
    blurTimeout,
    'Blur generation',
  );

  return {
    optimized,
    blurData,
    contentHash,
    originalSize: originalBuffer.length,
  };
}
