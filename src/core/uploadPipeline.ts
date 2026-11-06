import {
  deleteUploadedImage,
  isHeicAsset,
  resolveInitialQuality,
  runTransformAsset,
  type TransformAssetFn,
  type UploadMode,
  uploadAsset,
} from '../client';
import {
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';
import {
  type CropStrategy,
  type ExplicitOutputFormat,
  type ImageAspectRatio,
  type ImageDimensions,
  QUALITY_PRESETS,
  type QualityLevel,
  STANDARD_PRESETS,
  type StandardPresetName,
  type UploadedImageData,
  type UploadLocale,
  type UploadPresetConfig,
} from '../types';
import { validateImageFile } from '../utils/validators';

export type CoreUploadVisualState =
  | 'idle'
  | 'dragging'
  | 'uploading'
  | 'ready'
  | 'error'
  | 'disabled';

export interface CoreUploadRequestParams {
  preset?: string;
  folder?: string;
  bucket?: string;
  altText?: string;
  customFilename?: string;
  outputFormat?: ExplicitOutputFormat;
  quality?: number;
  maxDimensions?: ImageDimensions;
  aspectRatio?: Exclude<ImageAspectRatio, 'auto'>;
  crop?: CropStrategy;
  metadata?: Record<string, string>;
  signal: AbortSignal;
  onUploadProgress: (progress: number) => void;
}

export type CoreCustomUploaderFn = (
  file: File,
  params: CoreUploadRequestParams,
) => Promise<UploadedImageData>;

export interface CoreUploadConfigShape {
  endpoint?: string;
  deleteEndpoint?: string;
  uploadMode?: UploadMode;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  locale?: UploadLocale;
  defaultPreset?: string;
  requireAltText?: boolean;
  unstyled?: boolean;
  customUploader?: CoreCustomUploaderFn;
  uploader?: CoreCustomUploaderFn;
  customDeleter?: (data: UploadedImageData | string) => Promise<void>;
}

export interface CoreBaseUploadOptionsShape<TPreset extends string = string> {
  preset?: TPreset;
  folder?: string;
  bucket?: string;
  endpoint?: string;
  deleteEndpoint?: string;
  uploadMode?: UploadMode;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  locale?: UploadLocale;
  maxSizeMB?: number;
  allowedFormats?: string[];
  outputFormat?: ExplicitOutputFormat;
  quality?: QualityLevel | number;
  maxDimensions?: ImageDimensions;
  aspectRatio?: ImageAspectRatio;
  crop?: CropStrategy;
  customFilename?: string;
  metadata?: Record<string, string>;
  requireAltText?: boolean;
  unstyled?: boolean;
  transformAsset?: TransformAssetFn<File>;
  customUploader?: CoreCustomUploaderFn;
  uploader?: CoreCustomUploaderFn;
  customDeleter?: (data: UploadedImageData | string) => Promise<void>;
}

export interface CoreResolvedUploadEnv<
  TConfig extends CoreUploadConfigShape = CoreUploadConfigShape,
> {
  cfg: TConfig;
  preset: string | undefined;
  stdPreset: UploadPresetConfig | undefined;
  locale: UploadLocale;
  ui: UploadTranslations;
  maxSizeMB: number;
  allowedFormats: string[] | undefined;
  initQualityLevel: QualityLevel;
  requireAltText: boolean;
}

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
}): CoreUploadVisualState {
  if (flags.disabled) return 'disabled';
  if (flags.isDragging) return 'dragging';
  if (flags.isUploading) return 'uploading';
  if (flags.hasError) return 'error';
  if (flags.hasContent) return 'ready';
  return 'idle';
}

export function buildResolvedUploadEnv<TConfig extends CoreUploadConfigShape>(
  cfg: TConfig,
  options: CoreBaseUploadOptionsShape,
): CoreResolvedUploadEnv<TConfig> {
  const preset = (options.preset ?? cfg.defaultPreset) as string | undefined;
  const stdPreset = preset ? STANDARD_PRESETS[preset as StandardPresetName] : undefined;
  const locale: UploadLocale = normalizeUploadLocale(options.locale ?? cfg.locale ?? 'en');
  const ui = resolveTranslations(locale);
  const maxSizeMB = options.maxSizeMB ?? stdPreset?.maxSizeMB ?? 10;
  const allowedFormats = options.allowedFormats ?? stdPreset?.allowedFormats;
  const initQualityLevel: QualityLevel =
    typeof options.quality === 'string'
      ? options.quality
      : resolveInitialQuality(
          options.quality ?? stdPreset?.quality,
          stdPreset?.recommendedQualityLevel,
        );
  const requireAltText = Boolean(options.requireAltText ?? cfg.requireAltText);

  return {
    cfg, preset, stdPreset, locale, ui, maxSizeMB,
    allowedFormats, initQualityLevel, requireAltText,
  };
}

export async function prepareAndValidateCoreAsset<TConfig extends CoreUploadConfigShape>(params: {
  file: File;
  env: CoreResolvedUploadEnv<TConfig>;
  options: CoreBaseUploadOptionsShape;
  signal: AbortSignal;
  index: number;
}): Promise<{ file?: File; error?: string }> {
  const { file, env, options, signal, index } = params;
  if (isHeicAsset(file) && !options.transformAsset) {
    return { error: env.ui.heicUnsupported };
  }
  const workingFile = await runTransformAsset(file, options.transformAsset, {
    signal, preset: env.preset, index,
  });
  if (isHeicAsset(workingFile)) {
    return { error: env.ui.heicUnsupported };
  }
  const validationErr = validateImageFile(
    workingFile, env.maxSizeMB, env.locale, env.allowedFormats,
  );
  if (validationErr) return { error: validationErr };
  return { file: workingFile };
}

export async function executeCoreUploadRequest<TConfig extends CoreUploadConfigShape>(params: {
  file: File;
  env: CoreResolvedUploadEnv<TConfig>;
  options: CoreBaseUploadOptionsShape;
  qualityLevel: QualityLevel;
  altText?: string;
  signal: AbortSignal;
  onUploadProgress: (pct: number) => void;
}): Promise<UploadedImageData> {
  const { file, env, options, qualityLevel, altText, signal, onUploadProgress } = params;
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

  const uploader =
    options.customUploader ?? options.uploader ?? env.cfg.customUploader ?? env.cfg.uploader;
  if (uploader) {
    return uploader(file, { ...requestFields, signal, onUploadProgress });
  }

  return uploadAsset(file, requestFields, {
    endpoint: env.cfg.endpoint ?? '/api/upload',
    mode: options.uploadMode ?? env.cfg.uploadMode ?? 'direct',
    headers: env.cfg.headers,
    withCredentials: env.cfg.withCredentials,
    signal,
    onUploadProgress,
  });
}

export async function executeCoreDeleteRequest<TConfig extends CoreUploadConfigShape>(
  data: UploadedImageData | string | null | undefined,
  env: CoreResolvedUploadEnv<TConfig>,
  options?: CoreBaseUploadOptionsShape,
): Promise<void> {
  if (!data) return;
  const deleter = options?.customDeleter ?? env.cfg.customDeleter;
  if (deleter) {
    await deleter(data);
    return;
  }
  const deleteEndpoint = options?.deleteEndpoint ?? env.cfg.deleteEndpoint;
  const url = typeof data === 'string' ? data : data.url;
  if (deleteEndpoint && url) {
    try {
      await deleteUploadedImage(deleteEndpoint, url, {
        headers: env.cfg.headers,
        withCredentials: env.cfg.withCredentials,
      });
    } catch {
      // Non-fatal remote delete cleanup error
    }
  }
}
