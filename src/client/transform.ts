import type {
  TransformAssetContext,
  TransformAssetFn,
  UploadableAsset,
} from './types';
import { createUploadAbortError } from './xhrUpload';

/**
 * Runs an optional `transformAsset` hook with `AbortSignal` enforcement before
 * starting network transmission.
 */
export async function runTransformAsset<
  TAsset extends UploadableAsset = UploadableAsset,
>(
  asset: TAsset,
  transformAsset: TransformAssetFn<TAsset> | undefined,
  context: TransformAssetContext,
): Promise<TAsset> {
  if (context.signal.aborted) {
    throw createUploadAbortError();
  }
  if (!transformAsset) {
    return asset;
  }
  const transformed = await transformAsset(asset, context);
  if (context.signal.aborted) {
    throw createUploadAbortError();
  }
  return transformed;
}
