import { UploadKitError } from '../../types/errors';

export interface ImageResourceLimits {
  /** Maximum allowed image width in pixels. */
  maxWidth?: number;
  /** Maximum allowed image height in pixels. */
  maxHeight?: number;
  /** Maximum allowed total pixel count (`width * height`). */
  maxPixels?: number;
  /** Maximum allowed animation frames / pages (e.g. animated GIF / WebP / AVIF). */
  maxFrames?: number;
}

export interface ImageMetadataLike {
  width?: number;
  height?: number;
  pages?: number;
  frames?: number;
}

export const DEFAULT_IMAGE_RESOURCE_LIMITS: Required<ImageResourceLimits> = {
  maxWidth: 16_384,
  maxHeight: 16_384,
  maxPixels: 100_000_000,
  maxFrames: 120,
};

/**
 * Validates decoded image metadata against configured resource limits
 * (`maxWidth`, `maxHeight`, `maxPixels`, `maxFrames`).
 * Throws `UploadKitError` with `INVALID_IMAGE` or `RESOURCE_LIMIT_EXCEEDED`.
 */
export function assertImageMetadataLimits(
  meta: ImageMetadataLike | null | undefined,
  limits: ImageResourceLimits = {},
): void {
  if (
    !meta ||
    typeof meta.width !== 'number' ||
    typeof meta.height !== 'number' ||
    !Number.isFinite(meta.width) ||
    !Number.isFinite(meta.height) ||
    meta.width <= 0 ||
    meta.height <= 0
  ) {
    throw new UploadKitError(
      'Invalid image metadata: missing or non-positive dimensions',
      { code: 'INVALID_IMAGE', status: 400, retryable: false },
    );
  }

  if (
    typeof limits.maxWidth === 'number' &&
    limits.maxWidth > 0 &&
    meta.width > limits.maxWidth
  ) {
    throw new UploadKitError(
      `Image width (${meta.width}px) exceeds maximum allowed width of ${limits.maxWidth}px`,
      {
        code: 'RESOURCE_LIMIT_EXCEEDED',
        status: 400,
        retryable: false,
        metadata: { width: meta.width, maxWidth: limits.maxWidth },
      },
    );
  }

  if (
    typeof limits.maxHeight === 'number' &&
    limits.maxHeight > 0 &&
    meta.height > limits.maxHeight
  ) {
    throw new UploadKitError(
      `Image height (${meta.height}px) exceeds maximum allowed height of ${limits.maxHeight}px`,
      {
        code: 'RESOURCE_LIMIT_EXCEEDED',
        status: 400,
        retryable: false,
        metadata: { height: meta.height, maxHeight: limits.maxHeight },
      },
    );
  }

  const pixels = meta.width * meta.height;
  if (
    typeof limits.maxPixels === 'number' &&
    limits.maxPixels > 0 &&
    pixels > limits.maxPixels
  ) {
    throw new UploadKitError(
      `Image pixel count (${pixels}) exceeds maximum allowed limit of ${limits.maxPixels} pixels`,
      {
        code: 'RESOURCE_LIMIT_EXCEEDED',
        status: 400,
        retryable: false,
        metadata: { pixels, maxPixels: limits.maxPixels },
      },
    );
  }

  const frames = meta.frames ?? meta.pages ?? 1;
  if (
    typeof limits.maxFrames === 'number' &&
    limits.maxFrames > 0 &&
    Number.isFinite(frames) &&
    frames > limits.maxFrames
  ) {
    throw new UploadKitError(
      `Image frame count (${frames}) exceeds maximum allowed limit of ${limits.maxFrames} frames`,
      {
        code: 'RESOURCE_LIMIT_EXCEEDED',
        status: 400,
        retryable: false,
        metadata: { frames, maxFrames: limits.maxFrames },
      },
    );
  }
}
