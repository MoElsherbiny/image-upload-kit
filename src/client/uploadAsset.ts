import type { UploadedImageData } from '../types';
import { uploadViaPresignedUrl } from './presignedUpload';
import { type RetryOptions, withRetry } from './retry';
import type { UploadableAsset, UploadMode } from './types';
import {
  buildUploadFormData,
  type UploadFormFields,
  uploadViaXhr,
  type XhrUploadOptions,
} from './xhrUpload';

export interface UploadAssetRequestOptions extends XhrUploadOptions {
  /** Upload transport mode: `'direct'` (single-hop FormData POST) or `'presigned'` (presign -> storage -> finalize). Defaults to `'direct'`. */
  mode?: UploadMode;
  /** Endpoint URL (defaults to `'/api/upload'`) */
  endpoint?: string;
  /** Optional retry configuration for transient failures (network, 429, 503, 5xx). Pass `true` for default exponential backoff. */
  retry?: RetryOptions | boolean;
}

/**
 * Universal dispatcher that uploads an `UploadableAsset` via either direct `FormData` XHR
 * (`mode: 'direct'`) or two-step presigned storage upload (`mode: 'presigned'`).
 */
export function uploadAsset(
  asset: UploadableAsset,
  fields: UploadFormFields = {},
  options: UploadAssetRequestOptions = {},
): Promise<UploadedImageData> {
  const endpoint = options.endpoint ?? '/api/upload';
  const execute = (): Promise<UploadedImageData> => {
    if (options.mode === 'presigned') {
      return uploadViaPresignedUrl(endpoint, asset, fields, options);
    }
    return uploadViaXhr(endpoint, buildUploadFormData(asset, fields), options);
  };

  if (!options.retry) {
    return execute();
  }

  const retryOptions: RetryOptions =
    options.retry === true
      ? { signal: options.signal }
      : { signal: options.signal, ...options.retry };
  return withRetry(() => execute(), retryOptions);
}
