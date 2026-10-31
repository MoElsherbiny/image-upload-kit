import type { UploadPresetName } from './presets';
import type {
  ExplicitOutputFormat,
  ImageDimensions,
  ImageOutputFormat,
} from './quality';

export interface ImageUploadOptions<
  TPreset extends string = UploadPresetName,
> {
  /** Optional preset key (e.g. 'avatar', 'hero', or a custom project preset) */
  preset?: TPreset;
  /** Target storage bucket (overrides preset & uploader defaultBucket) */
  bucket?: string;
  /** Target folder path inside the bucket (e.g. 'products/shoes' or 'users/42') */
  folder?: string;
  /** Maximum bounding box dimensions (overrides preset maxDimensions) */
  maxDimensions?: ImageDimensions;
  /** Maximum allowed input size in MB */
  maxSizeMB?: number;
  /** Allowed MIME types */
  allowedFormats?: string[];
  /** Explicit output format; omit for smart size-guarded AVIF/WebP selection */
  outputFormat?: ExplicitOutputFormat;
  /** 1–100 compression quality */
  quality?: number;
  /** Optional custom filename (automatically sanitized) */
  customFilename?: string;
  /** Alt text description for accessibility & SEO */
  altText?: string;
  /** Arbitrary project-specific context/metadata (e.g. { entityId: '42', scope: 'catalog' }) */
  metadata?: Record<string, string>;
  /** Generate compact BlurHash string alongside WebP LQIP data URL */
  includeBlurHash?: boolean;
}

export interface UploadedImageData {
  url: string;
  blurDataUrl: string;
  blurColor: string;
  blurHash?: string;
  altText?: string;
  width: number;
  height: number;
  format: ImageOutputFormat;
  size: number;
  originalSize?: number;
  contentHash: string;
  storagePath?: string;
  bucket?: string;
  preset?: string;
  folder?: string;
  metadata?: Record<string, string>;
  uploadedAt: string;
}

export interface ImageUploadRecord extends UploadedImageData {
  quality: number;
}
