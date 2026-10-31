export type BlurPlaceholderType = 'default' | 'hero' | 'card' | 'thumbnail';

export type BlurSize = 'small' | 'medium';

export interface BlurDataOptions {
  type?: BlurPlaceholderType;
  size?: BlurSize;
  width?: number;
  height?: number;
  punch?: number;
}

export interface BlurManifestEntry {
  hash: string;
  variants: {
    small: string;
    medium?: string;
    [key: string]: string | undefined;
  };
  color: string;
  width?: number;
  height?: number;
  metadata?: Record<string, string>;
}

export interface BlurManifestData {
  version: string;
  generatedAt: string;
  totalImages: number;
  processedImages?: number;
  cachedImages?: number;
  failedImages?: number;
  hashes: Record<string, BlurManifestEntry>;
}

export interface BlurCacheEntry {
  dataUrl: string;
  timestamp: number;
}

export interface BlurServiceMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
}

export interface BlurImageSource {
  url?: string;
  blurDataUrl?: string | null;
  blurColor?: string | null;
  blurHash?: string | null;
  altText?: string | null;
  width?: number;
  height?: number;
}

export interface BlurData {
  blurDataUrl: string;
  blurColor: string;
  blurHash?: string;
  hasBlur: boolean;
}

export interface BlurServiceConfig {
  cacheSize?: number;
  manifest?: BlurManifestData | Record<string, BlurManifestEntry>;
}
