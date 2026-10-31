import type { StorageAdapter, UploadRecordHook } from '../../storage/types';
import type {
  ExplicitOutputFormat,
  ImageDimensions,
  ImageOutputFormat,
  ImageUploadOptions,
  StandardPresetName,
  UploadedImageData,
  UploadPresetConfig,
} from '../../types';
import type { BlurHashResult, OptimizedImageResult } from '../optimization';

export interface ProcessedImageBufferResult {
  optimized: OptimizedImageResult;
  blurData: BlurHashResult;
  contentHash: string;
  originalSize: number;
}

export interface ProcessImageBufferOptions {
  maxDimensions?: ImageDimensions;
  outputFormat?: ExplicitOutputFormat;
  quality?: number;
  includeBlurHash?: boolean;
  optimizationTimeoutMs?: number;
  blurTimeoutMs?: number;
}

export interface StoragePathContext {
  bucket: string;
  folder?: string;
  preset?: string;
  format: ImageOutputFormat;
  extension: string;
  customFilename?: string;
  contentHash: string;
  originalName?: string;
  metadata?: Record<string, string>;
}

export interface GeneratedStorageTarget {
  bucket: string;
  path: string;
  filename: string;
}

export type StoragePathGenerator = (
  context: StoragePathContext,
) => GeneratedStorageTarget;

export interface ImageUploaderOptions<
  TPresets extends Record<string, UploadPresetConfig> = Record<
    StandardPresetName,
    UploadPresetConfig
  >,
> {
  /** Pluggable storage backend (Supabase, S3, R2, Local FS, Memory, or custom) */
  storage: StorageAdapter;
  /** Default bucket name when neither `options.bucket` nor `preset.bucket` is provided (defaults to `'images'`) */
  defaultBucket?: string;
  /** Default folder prefix within the bucket (defaults to `''` or preset folder) */
  defaultFolder?: string;
  /** Default max input size in MB (defaults to `10`) */
  defaultMaxSizeMB?: number;
  /** Default allowed MIME formats */
  defaultAllowedFormats?: string[];
  /** Default max bounding box dimensions (defaults to `1920x1080`) */
  defaultMaxDimensions?: ImageDimensions;
  /**
   * Project-specific named presets (merged over universal `STANDARD_PRESETS` unless `includeStandardPresets: false`).
   * Preset names are automatically inferred in `uploader.uploadImage(file, { preset })`.
   */
  presets?: TPresets;
  /** Include universal visual role presets (`thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`). Defaults to `true`. */
  includeStandardPresets?: boolean;
  /** Custom storage path generator for full control over bucket/folder/filename layout */
  pathGenerator?: StoragePathGenerator;
  /** Optional database/analytics hook invoked after each successful upload */
  onUploadRecord?: UploadRecordHook;
  /** Wait for `onUploadRecord` before returning (defaults to `false` best-effort) */
  awaitRecordHook?: boolean;
  /** Max concurrent Sharp + LQIP image processing pipelines (defaults to `2`) */
  concurrency?: number;
  /** Timeout per Sharp optimization job in ms (defaults to `60000`) */
  optimizationTimeoutMs?: number;
  /** Timeout per LQIP/blur generation job in ms (defaults to `30000`) */
  blurTimeoutMs?: number;
  /** Generate compact BlurHash strings by default on every upload */
  includeBlurHash?: boolean;
}

export type InferredPresetKey<
  TPresets extends Record<string, UploadPresetConfig>,
  TIncludeStandard extends boolean = true,
> =
  | (keyof TPresets & string)
  | (TIncludeStandard extends false ? never : StandardPresetName)
  | (string & {});

export interface ImageUploader<TPreset extends string = string> {
  uploadImage(
    file:
      | File
      | { buffer: Buffer; name?: string; type: string; size?: number },
    options?: ImageUploadOptions<TPreset>,
  ): Promise<UploadedImageData>;
  processBuffer(
    buffer: Buffer,
    options?: ProcessImageBufferOptions,
  ): Promise<ProcessedImageBufferResult>;
  deleteImage(path: string, bucket?: string): Promise<void>;
  deleteByUrl(url: string): Promise<boolean>;
  resolvePreset(presetName?: string): UploadPresetConfig | undefined;
}
