export type UploadLocale = 'en' | 'ar';

export type ImageOutputFormat = 'avif' | 'webp' | 'jpeg' | 'png' | 'svg';

export type ExplicitOutputFormat = 'avif' | 'webp' | 'jpeg' | 'png';

export type QualityLevel = 'low' | 'medium' | 'high' | 'maximum';

export interface QualityPreset {
  label: string;
  labelAr: string;
  value: number;
  description: string;
  descriptionAr: string;
  /** Rough fraction of original bytes after modern AVIF/WebP compression */
  compressionRatio: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low',
    labelAr: 'منخفضة',
    value: 50,
    description: 'Smallest file — best for tiny thumbnails and icons',
    descriptionAr: 'أصغر حجم — مناسب للمصغرات والأيقونات الصغيرة',
    compressionRatio: 0.12,
  },
  medium: {
    label: 'Medium',
    labelAr: 'متوسطة',
    value: 72,
    description: 'Balanced size and quality — suitable for most web images',
    descriptionAr: 'توازن بين الحجم والجودة — مناسب لمعظم صور الويب',
    compressionRatio: 0.22,
  },
  high: {
    label: 'High',
    labelAr: 'عالية',
    value: 85,
    description: 'Recommended — sharp visuals with excellent compression',
    descriptionAr: 'موصى به — جودة عالية وضغط ممتاز',
    compressionRatio: 0.3,
  },
  maximum: {
    label: 'Maximum',
    labelAr: 'أقصى جودة',
    value: 95,
    description: 'Closest to original — large file, use for hero / print',
    descriptionAr: 'أقرب للأصل — حجم كبير، مناسب للصور الرئيسية والطباعة',
    compressionRatio: 0.55,
  },
};

export interface ImageDimensions {
  width: number;
  height: number;
}
