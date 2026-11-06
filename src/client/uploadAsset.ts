import type { UploadedImageData } from '../types';
import { uploadViaPresignedUrl } from './presignedUpload';
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
  if (options.mode === 'presigned') {
    return uploadViaPresignedUrl(endpoint, asset, fields, options);
  }
  return uploadViaXhr(endpoint, buildUploadFormData(asset, fields), options);
}
