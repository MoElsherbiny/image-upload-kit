import { isNativeAsset } from './asset';
import type {
  TransformAssetContext,
  TransformAssetFn,
  UploadableAsset,
} from './types';
import { createUploadAbortError, isUploadAbortError } from './xhrUpload';

export interface ClientResizeTransformOptions {
  /** Maximum output width in pixels (defaults to `2048`) */
  maxWidth?: number;
  /** Maximum output height in pixels (defaults to `2048`) */
  maxHeight?: number;
  /** Encoding quality from `0` to `1` (defaults to `0.9`) */
  quality?: number;
  /** Preferred output MIME type (defaults to `'image/webp'` with `'image/jpeg'` fallback) */
  mimeType?: 'image/webp' | 'image/jpeg';
  /** Skip client-side downscaling when file size is below this threshold in bytes (defaults to `0`) */
  skipBelowBytes?: number;
  /** Keep the re-encoded output even if its byte size is larger than the input (defaults to `false`) */
  keepLargerOutput?: boolean;
}

const BYPASS_MIME_TYPES = new Set(['image/svg+xml', 'image/gif']);

function replaceExtension(filename: string, mimeType: string): string {
  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const lastDot = filename.lastIndexOf('.');
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename || 'upload';
  return `${stem}.${ext}`;
}

/**
 * Creates a browser pre-upload downscaling transform using `createImageBitmap` + `OffscreenCanvas`.
 * Keeps `src/client` 100% DOM-free at import time (never calls `document.createElement('canvas')`),
 * respects `AbortSignal`, preserves EXIF orientation via `imageOrientation: 'from-image'`,
 * falls back to the original asset on decode/encode errors or if re-encoding increases byte size,
 * and safely passes through SVGs, GIFs, small images, and environments without `OffscreenCanvas`.
 */
export function createClientResizeTransform<
  TAsset extends UploadableAsset = File,
>(options: ClientResizeTransformOptions = {}): TransformAssetFn<TAsset> {
  const maxWidth = Math.max(1, options.maxWidth ?? 2048);
  const maxHeight = Math.max(1, options.maxHeight ?? 2048);
  const quality = Math.max(0.1, Math.min(1, options.quality ?? 0.9));
  const preferredMime = options.mimeType ?? 'image/webp';
  const skipBelowBytes = options.skipBelowBytes ?? 0;
  const keepLargerOutput = Boolean(options.keepLargerOutput);

  return async (
    asset: TAsset,
    context: TransformAssetContext,
  ): Promise<TAsset> => {
    if (context.signal.aborted) {
      throw createUploadAbortError('Transform aborted');
    }
    if (isNativeAsset(asset) || typeof File === 'undefined' || !(asset instanceof Blob)) {
      return asset;
    }
    const mime = (asset.type || '').toLowerCase();
    if (BYPASS_MIME_TYPES.has(mime)) {
      return asset;
    }
    if (skipBelowBytes > 0 && asset.size > 0 && asset.size < skipBelowBytes) {
      return asset;
    }
    if (
      typeof createImageBitmap !== 'function' ||
      typeof OffscreenCanvas === 'undefined'
    ) {
      return asset;
    }

    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(asset, {
        imageOrientation: 'from-image',
      });
      if (context.signal.aborted) {
        throw createUploadAbortError('Transform aborted');
      }
      const { width, height } = bitmap;
      if (width <= maxWidth && height <= maxHeight) {
        return asset;
      }

      const scale = Math.min(maxWidth / width, maxHeight / height);
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));

      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return asset;
      }
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

      let blob = await canvas.convertToBlob({
        type: preferredMime,
        quality,
      });
      let finalMime = blob.type || preferredMime;
      if (preferredMime === 'image/webp' && finalMime !== 'image/webp') {
        blob = await canvas.convertToBlob({
          type: 'image/jpeg',
          quality,
        });
        finalMime = 'image/jpeg';
      }

      if (context.signal.aborted) {
        throw createUploadAbortError('Transform aborted');
      }

      if (!keepLargerOutput && asset.size > 0 && blob.size >= asset.size) {
        return asset;
      }

      if (asset instanceof File) {
        const nextName = replaceExtension(asset.name, finalMime);
        return new File([blob], nextName, {
          type: finalMime,
          lastModified: asset.lastModified,
        }) as unknown as TAsset;
      }
      return blob as unknown as TAsset;
    } catch (err) {
      if (context.signal.aborted || isUploadAbortError(err)) {
        throw createUploadAbortError('Transform aborted');
      }
      return asset;
    } finally {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  };
}

/**
 * Composes multiple `TransformAssetFn` functions sequentially while checking `AbortSignal` between steps.
 */
export function composeTransforms<
  TAsset extends UploadableAsset = UploadableAsset,
>(...transforms: Array<TransformAssetFn<TAsset> | undefined>): TransformAssetFn<TAsset> {
  return async (asset: TAsset, context: TransformAssetContext): Promise<TAsset> => {
    let current = asset;
    for (const fn of transforms) {
      if (!fn) continue;
      if (context.signal.aborted) {
        throw createUploadAbortError('Transform aborted');
      }
      current = await fn(current, context);
    }
    return current;
  };
}
