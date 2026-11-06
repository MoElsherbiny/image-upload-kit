import {
  buildResolvedUploadEnv,
  computeVisualState,
  type CoreResolvedUploadEnv,
  createBlobPreview,
  executeCoreDeleteRequest,
  executeCoreUploadRequest,
  prepareAndValidateCoreAsset,
  revokeBlobUrl,
} from '../../core/uploadPipeline';
import type { QualityLevel, UploadedImageData } from '../../types';
import { injectImageUploadConfig } from '../config';
import type {
  AngularBaseUploadOptions,
  ImageUploadAngularConfig,
} from '../types';

export { computeVisualState, createBlobPreview, revokeBlobUrl };

export type ResolvedControllerEnv =
  CoreResolvedUploadEnv<ImageUploadAngularConfig>;

export function resolveControllerEnv(
  options: AngularBaseUploadOptions,
): ResolvedControllerEnv {
  const baseWithExplicitConfig = injectImageUploadConfig(options.config);
  const cfg = injectImageUploadConfig({
    ...baseWithExplicitConfig,
    endpoint: options.endpoint ?? baseWithExplicitConfig.endpoint,
    deleteEndpoint:
      options.deleteEndpoint ?? baseWithExplicitConfig.deleteEndpoint,
    uploadMode: options.uploadMode ?? baseWithExplicitConfig.uploadMode,
    headers: options.headers ?? baseWithExplicitConfig.headers,
    withCredentials:
      options.withCredentials ?? baseWithExplicitConfig.withCredentials,
    locale: options.locale ?? baseWithExplicitConfig.locale,
    requireAltText:
      options.requireAltText ?? baseWithExplicitConfig.requireAltText,
    customUploader:
      options.customUploader ??
      options.uploader ??
      baseWithExplicitConfig.customUploader ??
      baseWithExplicitConfig.uploader,
    customDeleter:
      options.customDeleter ?? baseWithExplicitConfig.customDeleter,
    unstyled: options.unstyled ?? baseWithExplicitConfig.unstyled,
  });

  return buildResolvedUploadEnv(cfg, options);
}

export async function prepareAndValidateAsset(params: {
  file: File;
  env: ResolvedControllerEnv;
  options: AngularBaseUploadOptions;
  signal: AbortSignal;
  index: number;
}): Promise<{ file?: File; error?: string }> {
  return prepareAndValidateCoreAsset(params);
}

export async function executeUploadRequest(params: {
  file: File;
  env: ResolvedControllerEnv;
  options: AngularBaseUploadOptions;
  qualityLevel: QualityLevel;
  altText?: string;
  signal: AbortSignal;
  onUploadProgress: (pct: number) => void;
}): Promise<UploadedImageData> {
  return executeCoreUploadRequest(params);
}

export async function executeDeleteRequest(
  data: UploadedImageData | string,
  env: ResolvedControllerEnv,
  options?: AngularBaseUploadOptions,
): Promise<void> {
  return executeCoreDeleteRequest(data, env, options);
}
