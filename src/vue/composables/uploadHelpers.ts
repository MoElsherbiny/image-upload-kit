import {
  buildResolvedUploadEnv,
  type CoreResolvedUploadEnv,
  computeVisualState,
  createBlobPreview,
  executeCoreDeleteRequest,
  executeCoreUploadRequest,
  prepareAndValidateCoreAsset,
  revokeBlobUrl,
} from '../../core/uploadPipeline';
import type { QualityLevel, UploadedImageData } from '../../types';
import { useImageUploadConfig } from '../config';
import type { ImageUploadVueConfig, VueBaseUploadOptions } from '../types';

export { computeVisualState, createBlobPreview, revokeBlobUrl };

export type ResolvedVueControllerEnv =
  CoreResolvedUploadEnv<ImageUploadVueConfig>;

export function resolveControllerEnv(
  options: VueBaseUploadOptions,
  baseConfig?: ImageUploadVueConfig,
): ResolvedVueControllerEnv {
  const cfg = useImageUploadConfig(
    {
      endpoint: options.endpoint,
      deleteEndpoint: options.deleteEndpoint,
      headers: options.headers,
      withCredentials: options.withCredentials,
      locale: options.locale,
      uploadMode: options.uploadMode,
      customUploader: options.customUploader ?? options.uploader,
      customDeleter: options.customDeleter,
      requireAltText: options.requireAltText,
      unstyled: options.unstyled,
    },
    baseConfig,
  );

  return buildResolvedUploadEnv(cfg, options);
}

export async function prepareAndValidateAsset(params: {
  file: File;
  env: ResolvedVueControllerEnv;
  options: VueBaseUploadOptions;
  signal: AbortSignal;
  index: number;
}): Promise<{ file?: File; error?: string }> {
  return prepareAndValidateCoreAsset(params);
}

export async function executeUploadRequest(params: {
  file: File;
  env: ResolvedVueControllerEnv;
  options: VueBaseUploadOptions;
  qualityLevel: QualityLevel;
  altText?: string;
  signal: AbortSignal;
  onUploadProgress: (pct: number) => void;
}): Promise<UploadedImageData> {
  return executeCoreUploadRequest(params);
}

export async function executeDeleteRequest(
  data: UploadedImageData | string | null | undefined,
  env: ResolvedVueControllerEnv,
  options?: VueBaseUploadOptions,
): Promise<void> {
  return executeCoreDeleteRequest(data, env, options);
}
