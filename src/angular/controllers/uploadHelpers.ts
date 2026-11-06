import {
  buildUploadFormData,
  isHeicAsset,
  resolveInitialQuality,
  runTransformAsset,
  uploadViaXhr,
} from '../../client';
import {
  QUALITY_PRESETS,
  type QualityLevel,
  STANDARD_PRESETS,
  type StandardPresetName,
  type UploadedImageData,
  type UploadLocale,
  type UploadPresetConfig,
} from '../../types';
import { validateImageFile } from '../../utils/validators';
import { injectImageUploadConfig } from '../config';
import type {
  AngularBaseUploadOptions,
  ImageUploadAngularConfig,
  UploadVisualState,
} from '../types';

export function revokeBlobUrl(url: string | null | undefined): void {
  if (
    url &&
    url.startsWith('blob:') &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke errors
    }
  }
}

export function createBlobPreview(file: File): string {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      return URL.createObjectURL(file);
    } catch {
      return '';
    }
  }
  return '';
}

export function computeVisualState(flags: {
  disabled: boolean;
  isDragging: boolean;
  isUploading: boolean;
  hasError: boolean;
  hasContent: boolean;
}): UploadVisualState {
  if (flags.disabled) return 'disabled';
  if (flags.isDragging) return 'dragging';
  if (flags.isUploading) return 'uploading';
  if (flags.hasError) return 'error';
  if (flags.hasContent) return 'ready';
  return 'idle';
}

export interface ResolvedControllerEnv {
  cfg: ImageUploadAngularConfig;
  preset: string | undefined;
  stdPreset: UploadPresetConfig | undefined;
  locale: UploadLocale;
  maxSizeMB: number;
  allowedFormats: string[] | undefined;
  initQualityLevel: QualityLevel;
}

export function resolveControllerEnv(
  options: AngularBaseUploadOptions,
): ResolvedControllerEnv {
  const cfg = injectImageUploadConfig({
    endpoint: options.endpoint,
    deleteEndpoint: options.deleteEndpoint,
    headers: options.headers,
    withCredentials: options.withCredentials,
    locale: options.locale,
    customUploader: options.customUploader ?? options.uploader,
    customDeleter: options.customDeleter,
    unstyled: options.unstyled,
  });

  const preset = (options.preset ?? cfg.defaultPreset) as string | undefined;
  const stdPreset = preset
    ? STANDARD_PRESETS[preset as StandardPresetName]
    : undefined;
  const locale: UploadLocale = cfg.locale ?? 'en';
  const maxSizeMB = options.maxSizeMB ?? stdPreset?.maxSizeMB ?? 10;
  const allowedFormats = options.allowedFormats ?? stdPreset?.allowedFormats;
  const initQualityLevel: QualityLevel =
    typeof options.quality === 'string'
      ? options.quality
      : resolveInitialQuality(
          options.quality ?? stdPreset?.quality,
          stdPreset?.recommendedQualityLevel,
        );

  return {
    cfg,
    preset,
    stdPreset,
    locale,
    maxSizeMB,
    allowedFormats,
    initQualityLevel,
  };
}

export async function prepareAndValidateAsset(params: {
  file: File;
  env: ResolvedControllerEnv;
  options: AngularBaseUploadOptions;
  signal: AbortSignal;
  index: number;
}): Promise<{ file?: File; error?: string }> {
  const { file, env, options, signal, index } = params;
  if (isHeicAsset(file) && !options.transformAsset) {
    return {
      error:
        env.locale === 'ar'
          ? 'صيغة HEIC/HEIF تتطلب محول transformAsset قبل الرفع'
          : 'HEIC/HEIF images require a transformAsset converter before upload',
    };
  }

  const workingFile = await runTransformAsset(file, options.transformAsset, {
    signal,
    preset: env.preset,
    index,
  });

  if (isHeicAsset(workingFile)) {
    return { error: 'HEIC/HEIF images are not supported by browsers directly' };
  }

  const validationErr = validateImageFile(
    workingFile,
    env.maxSizeMB,
    env.locale,
    env.allowedFormats,
  );
  if (validationErr) {
    return { error: validationErr };
  }
  return { file: workingFile };
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
  const { file, env, options, qualityLevel, altText, signal, onUploadProgress } =
    params;
  const numericQuality =
    typeof options.quality === 'number'
      ? options.quality
      : QUALITY_PRESETS[qualityLevel].value;
  const resolvedAspectRatio =
    options.aspectRatio && options.aspectRatio !== 'auto'
      ? options.aspectRatio
      : env.stdPreset?.aspectRatio;

  const requestFields = {
    preset: env.preset,
    folder: options.folder,
    bucket: options.bucket,
    altText: altText || undefined,
    customFilename: options.customFilename,
    outputFormat: options.outputFormat,
    quality: numericQuality,
    maxDimensions: options.maxDimensions,
    aspectRatio: resolvedAspectRatio,
    crop: options.crop ?? env.stdPreset?.crop,
    metadata: options.metadata,
  };

  const uploader = env.cfg.customUploader ?? env.cfg.uploader;
  if (uploader) {
    return uploader(file, { ...requestFields, signal, onUploadProgress });
  }

  return uploadViaXhr(
    env.cfg.endpoint ?? '/api/upload',
    buildUploadFormData(file, requestFields),
    {
      headers: env.cfg.headers,
      withCredentials: env.cfg.withCredentials,
      signal,
      onUploadProgress,
    },
  );
}
