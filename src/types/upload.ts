import type { CropStrategy, ImageAspectRatio } from './aspectRatio';
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
  /** Target aspect ratio for server-side smart cropping (Sharp `fit: 'cover'`) */
  aspectRatio?: Exclude<ImageAspectRatio, 'auto'>;
  /** Smart crop focus strategy when `aspectRatio` is configured. Defaults to `'attention'`. */
  crop?: CropStrategy;
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
  /** Opt-in to allow SVG uploads (sanitized before storage). Defaults to `false`. */
  allowSvg?: boolean;
  /** Maximum input pixel count allowed by Sharp (defaults to 50 MP = 50,000,000) */
  limitInputPixels?: number;
  /** Marks `customFilename` as client-supplied (disables upsert and retries with a suffix on collision) */
  isClientFilename?: boolean;
  /** Target widths (px) for responsive image variants (widths >= main output width are skipped) */
  variantWidths?: number[];
  /** Optional AbortSignal to cancel queued or in-flight processing */
  signal?: AbortSignal;
}

export interface ImageVariant {
  width: number;
  height: number;
  url: string;
  size: number;
  storagePath?: string;
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
  variants?: ImageVariant[];
  srcSet?: string;
  uploadedAt: string;
}

export interface ImageUploadRecord extends UploadedImageData {
  quality: number;
}
