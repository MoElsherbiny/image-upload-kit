import type {
  CropStrategy,
  ExplicitOutputFormat,
  ImageAspectRatio,
  ImageDimensions,
  ImageOutputFormat,
} from '../../types';
import type { TransformCache } from './transformCache';

export interface FocalPoint {
  /** Normalized horizontal coordinate in [0, 1] (0 = left, 0.5 = center, 1 = right) */
  x: number;
  /** Normalized vertical coordinate in [0, 1] (0 = top, 0.5 = center, 1 = bottom) */
  y: number;
}

export type OutputColorSpace = 'srgb' | 'preserve';

export interface OptimizedImageResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: ImageOutputFormat;
  size: number;
  quality?: number;
}

export interface BlurHashResult {
  dataURL: string;
  color: string;
  blurHash?: string;
}

export interface OptimizeImageOptions {
  /** Max bounding box dimensions (fit: 'inside', withoutEnlargement: true). Defaults to 1920x1080. */
  maxDimensions?: ImageDimensions;
  /** Target aspect ratio for server-side smart cropping (Sharp `fit: 'cover'`) */
  aspectRatio?: Exclude<ImageAspectRatio, 'auto'>;
  /** Smart crop focus strategy when `aspectRatio` is configured. Defaults to `'attention'`. */
  crop?: CropStrategy;
  /** Normalized [0, 1] focal point for aspect-ratio cropping (overrides `crop` position when set). */
  focalPoint?: FocalPoint;
  /** Explicit output format; omit for smart size-guarded AVIF/WebP selection */
  outputFormat?: ExplicitOutputFormat;
  /** 1–100 compression quality. Defaults to smart photo/graphic heuristic (85–88). */
  quality?: number;
  /** Maximum input pixel count allowed by Sharp (defaults to 50 MP = 50,000,000) */
  limitInputPixels?: number;
  /** Maximum allowed oriented input width in pixels before rejecting with validation error. */
  maxWidth?: number;
  /** Maximum allowed oriented input height in pixels before rejecting with validation error. */
  maxHeight?: number;
  /** Maximum allowed animation frames/pages before rejecting with validation error. */
  maxFrames?: number;
  /** Output color space conversion (`'srgb'` normalizes wide-gamut/CMYK to sRGB; `'preserve'` keeps source). */
  colorSpace?: OutputColorSpace;
  /** Preserve EXIF/ICC metadata instead of stripping it. Defaults to `false`. */
  preserveMetadata?: boolean;
  /** Optional custom SVG sanitizer hook forwarded to `sanitizeSvg` before the built-in allowlist pass. */
  customSanitizer?: (svg: string) => string;
  /** Optional transform result cache checked before encoding and populated after encoding. */
  transformCache?: TransformCache;
  /** Optional precomputed SHA-256 content hash used to build `transformCache` keys. */
  contentHash?: string;
  /** AVIF/WebP encoding effort (defaults to 6) */
  effort?: number;
}

export type OptimizationConfig = OptimizeImageOptions;

export const DEFAULT_LIMIT_INPUT_PIXELS = 50_000_000;

export interface GenerateBlurOptions {
  width?: number;
  fallbackWidth?: number;
  quality?: number;
  maxDataUrlChars?: number;
  includeBlurHash?: boolean;
}

export type ColorSamplingMode = 'balanced' | 'edge';
export type EdgeKey = 'top' | 'right' | 'bottom' | 'left';
export type EdgeColorSet = Record<EdgeKey, string>;

export const PRIMARY_AVIF_EFFORT = 6;
export const RETRY_AVIF_EFFORT = 5;

export const BLUR_PLACEHOLDER_WIDTH = 128;
export const BLUR_PLACEHOLDER_FALLBACK_WIDTH = 96;
export const BLUR_PLACEHOLDER_QUALITY = 80;
export const BLUR_PLACEHOLDER_MAX_CHARS = 8000;

export const EDGE_COLOR_FALLBACK = '#6B7280';
export const EDGE_WHITE_FALLBACK = '#F9FAFB';
export const WHITE_DOMINANCE_RATIO = 1.35;
