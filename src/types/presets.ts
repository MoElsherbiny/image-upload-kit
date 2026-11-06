import type {
  ExplicitOutputFormat,
  ImageDimensions,
  QualityLevel,
} from './quality';

/**
 * Universal visual role presets (project-agnostic).
 * Consumers can define their own presets via `defineUploadPresets` / `createImageUploader({ presets })`
 * or augment `UploadKitRegister` for global type-safety.
 */
export type StandardPresetName =
  | 'thumbnail'
  | 'avatar'
  | 'card'
  | 'cover'
  | 'hero'
  | 'logo'
  | 'original';

/**
 * Module augmentation hook for global preset autocomplete across a project:
 * ```ts
 * declare module 'img-upload-kit' {
 *   interface UploadKitRegister {
 *     presets: 'product-main' | 'product-thumb' | 'user-avatar';
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface UploadKitRegister {}

export type UploadPresetName = UploadKitRegister extends {
  presets: infer TCustom extends string;
}
  ? TCustom
  : StandardPresetName | (string & {});

export interface UploadPresetConfig {
  /** Target storage bucket for this preset */
  bucket?: string;
  /** Default folder prefix within the bucket (e.g. 'avatars' or 'products/thumbnails') */
  folder?: string;
  /** Maximum bounding box dimensions (aspect ratio preserved, never enlarged) */
  maxDimensions?: ImageDimensions;
  /** Maximum allowed source file size in MB */
  maxSizeMB?: number;
  /** Allowed source MIME types */
  allowedFormats?: string[];
  /** Force a specific output format; omit for smart size-guarded AVIF/WebP optimization */
  outputFormat?: ExplicitOutputFormat;
  /** Default compression quality (1–100) */
  quality?: number;
  /** Recommended UI quality tab for React `<QualitySelector />` */
  recommendedQualityLevel?: QualityLevel;
  /** Optional guidance note shown in `<QualitySelector />` */
  recommendationNote?: { en: string; ar?: string };
  /** Generate compact BlurHash string alongside WebP LQIP data URL */
  includeBlurHash?: boolean;
  /** Opt-in to allow SVG uploads for this preset (sanitized before storage). Defaults to `false`. */
  allowSvg?: boolean;
  /** Maximum input pixel count allowed by Sharp (defaults to 50 MP = 50,000,000) */
  limitInputPixels?: number;
  /** Optional local directory to mirror uploaded files into */
  mirrorDir?: string;
  /** Optional public URL prefix when `mirrorDir` is used */
  publicUrlBase?: string;
}

export const SVG_MIME_TYPE = 'image/svg+xml';

export const DEFAULT_ALLOWED_FORMATS: string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
];

export const RASTER_ALLOWED_FORMATS: string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
];

export const DEFAULT_IMAGE_DIMENSIONS: ImageDimensions = {
  width: 1920,
  height: 1080,
};

export const STANDARD_PRESETS: Record<StandardPresetName, UploadPresetConfig> = {
  thumbnail: {
    folder: 'thumbnails',
    maxDimensions: { width: 600, height: 600 },
    maxSizeMB: 5,
    quality: 78,
    recommendedQualityLevel: 'medium',
    allowedFormats: RASTER_ALLOWED_FORMATS,
    recommendationNote: {
      en: 'Thumbnails display at compact sizes — Medium quality keeps pages fast',
      ar: 'المصغرات تعرض بأحجام صغيرة — الجودة المتوسطة تحافظ على سرعة الصفحة',
    },
  },
  avatar: {
    folder: 'avatars',
    maxDimensions: { width: 512, height: 512 },
    maxSizeMB: 5,
    quality: 80,
    recommendedQualityLevel: 'medium',
    allowedFormats: RASTER_ALLOWED_FORMATS,
    recommendationNote: {
      en: 'Avatars display small — Medium quality balances sharpness and speed',
      ar: 'الصور الشخصية صغيرة — الجودة المتوسطة توازن بين الوضوح والسرعة',
    },
  },
  card: {
    folder: 'cards',
    maxDimensions: { width: 1200, height: 900 },
    maxSizeMB: 8,
    quality: 85,
    recommendedQualityLevel: 'high',
    allowedFormats: DEFAULT_ALLOWED_FORMATS,
  },
  cover: {
    folder: 'covers',
    maxDimensions: { width: 1920, height: 1080 },
    maxSizeMB: 10,
    quality: 88,
    recommendedQualityLevel: 'high',
    allowedFormats: DEFAULT_ALLOWED_FORMATS,
  },
  hero: {
    folder: 'hero',
    maxDimensions: { width: 2560, height: 1440 },
    maxSizeMB: 15,
    quality: 92,
    recommendedQualityLevel: 'maximum',
    allowedFormats: DEFAULT_ALLOWED_FORMATS,
    recommendationNote: {
      en: 'Full-width hero visuals benefit from Maximum quality to preserve fine detail',
      ar: 'الصور الرئيسية بعرض كامل تستفيد من الجودة القصوى للحفاظ على التفاصيل الدقيقة',
    },
  },
  logo: {
    folder: 'logos',
    maxDimensions: { width: 800, height: 800 },
    maxSizeMB: 5,
    quality: 90,
    recommendedQualityLevel: 'high',
    allowedFormats: DEFAULT_ALLOWED_FORMATS,
    recommendationNote: {
      en: 'Prefer SVG for vector logos — High quality preserves crisp edges on raster logos',
      ar: 'يفضل SVG للشعارات المتجهة — الجودة العالية تحافظ على حواف واضحة',
    },
  },
  original: {
    folder: 'originals',
    maxDimensions: { width: 4096, height: 4096 },
    maxSizeMB: 25,
    quality: 95,
    recommendedQualityLevel: 'maximum',
    allowedFormats: DEFAULT_ALLOWED_FORMATS,
  },
};

/**
 * Type-safe helper to define project-specific upload presets with full key inference.
 */
export function defineUploadPresets<
  T extends Record<string, UploadPresetConfig>,
>(presets: T): T {
  return presets;
}
