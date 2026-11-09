import { generateBlurPlaceholder, optimizeImage } from '../optimization';
import { withTimeout } from '../semaphore';
import { computeSha256Hex } from './dedupe';
import type {
  ProcessedImageBufferResult,
  ProcessImageBufferOptions,
} from './types';

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const err = new Error(
    typeof signal.reason === 'string' ? signal.reason : 'Operation aborted',
  );
  err.name = 'AbortError';
  throw err;
}

export async function processImageBuffer(
  originalBuffer: Buffer,
  options: ProcessImageBufferOptions = {},
): Promise<ProcessedImageBufferResult> {
  const optTimeout = options.optimizationTimeoutMs ?? 60000;
  const blurTimeout = options.blurTimeoutMs ?? 30000;

  throwIfAborted(options.signal);

  const contentHash =
    options.precomputedHash ?? (await computeSha256Hex(originalBuffer));

  throwIfAborted(options.signal);

  const optimized = await withTimeout(
    optimizeImage(originalBuffer, {
      maxDimensions: options.maxDimensions,
      aspectRatio: options.aspectRatio,
      crop: options.crop,
      outputFormat: options.outputFormat,
      quality: options.quality,
      limitInputPixels: options.limitInputPixels,
      effort: options.effort,
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

  throwIfAborted(options.signal);

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
