import { LRUCache } from './lruCache';
import { normalizeImagePath, type NormalizePathOptions } from './pathMapper';
import { DEFAULT_PLACEHOLDERS } from './placeholders';
import type {
  BlurCacheEntry,
  BlurManifestData,
  BlurManifestEntry,
  BlurPlaceholderType,
  BlurServiceMetrics,
  BlurSize,
} from './types';

export interface BlurServiceOptions {
  cacheSize?: number;
  manifest?: BlurManifestData | Record<string, BlurManifestEntry>;
  pathOptions?: NormalizePathOptions;
}

export class BlurService {
  private blurData: Record<string, BlurManifestEntry>;
  private readonly cache: LRUCache<string, BlurCacheEntry>;
  private readonly pathOptions?: NormalizePathOptions;
  private metadata: {
    version: string;
    generatedAt: string;
    totalImages: number;
  };
  private metrics: BlurServiceMetrics;

  constructor(options: BlurServiceOptions = {}) {
    this.blurData = {};
    this.pathOptions = options.pathOptions;
    this.metadata = {
      version: '2.0',
      generatedAt: new Date().toISOString(),
      totalImages: 0,
    };
    this.cache = new LRUCache(options.cacheSize ?? 500);
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
    };

    if (options.manifest) {
      this.loadManifest(options.manifest);
    }
  }

  /**
   * Hydrate the service with a generated `blur-hashes.json` manifest or hash map.
   */
  loadManifest(
    manifest: BlurManifestData | Record<string, BlurManifestEntry>,
  ): void {
    this.cache.clear();

    if ('hashes' in manifest && typeof manifest.hashes === 'object' && manifest.hashes !== null) {
      const typed = manifest as BlurManifestData;
      this.blurData = { ...typed.hashes };
      this.metadata = {
        version: typed.version || '2.0',
        generatedAt: typed.generatedAt || new Date().toISOString(),
        totalImages: Object.keys(this.blurData).length,
      };
    } else {
      this.blurData = { ...(manifest as Record<string, BlurManifestEntry>) };
      this.metadata = {
        version: '2.0',
        generatedAt: new Date().toISOString(),
        totalImages: Object.keys(this.blurData).length,
      };
    }
  }

  /**
   * Register or update a single image's blur data at runtime.
   */
  registerEntry(imagePath: string, entry: BlurManifestEntry): void {
    this.blurData[imagePath] = entry;
    this.metadata.totalImages = Object.keys(this.blurData).length;
    this.cache.clear();
  }

  getDefaultPlaceholder(type: BlurPlaceholderType = 'default'): string {
    return DEFAULT_PLACEHOLDERS[type];
  }

  private findBlurDataByPath(imageSrc: string): BlurManifestEntry | null {
    let data = this.blurData[imageSrc];
    if (data) return data;

    const pathInfo = normalizeImagePath(imageSrc, this.pathOptions);
    data = this.blurData[pathInfo.normalizedPath];
    if (data) return data;

    const withSlash = pathInfo.normalizedPath.startsWith('/')
      ? pathInfo.normalizedPath
      : '/' + pathInfo.normalizedPath;
    const withoutSlash = pathInfo.normalizedPath.replace(/^\/+/, '');

    data = this.blurData[withSlash] || this.blurData[withoutSlash];
    if (data) return data;

    if (pathInfo.isExternal && pathInfo.originalPath !== imageSrc) {
      data = this.blurData[pathInfo.originalPath];
      if (data) return data;
    }

    return null;
  }

  getDominantColor(imageSrc: string): string {
    const data = this.findBlurDataByPath(imageSrc);
    return data?.color || '#E5E7EB';
  }

  getBlurDataURL(
    imageSrc: string,
    options: {
      type?: BlurPlaceholderType;
      size?: BlurSize;
    } = {},
  ): string {
    const { type = 'default', size = 'small' } = options;

    this.metrics.totalRequests++;

    const cacheKey = `${imageSrc}-${size}`;
    if (this.cache.has(cacheKey)) {
      this.metrics.cacheHits++;
      return this.cache.get(cacheKey)!.dataUrl;
    }

    this.metrics.cacheMisses++;

    if (Object.keys(this.blurData).length === 0) {
      return this.getDefaultPlaceholder(type);
    }

    const data = this.findBlurDataByPath(imageSrc);
    if (!data) {
      return this.getDefaultPlaceholder(type);
    }

    const blurDataURL =
      data.variants?.[size] ||
      data.variants?.small ||
      this.getDefaultPlaceholder(type);

    this.cache.set(cacheKey, {
      dataUrl: blurDataURL,
      timestamp: Date.now(),
    });

    return blurDataURL;
  }

  getBulkBlurData(
    imageSrcs: string[],
    options: {
      type?: BlurPlaceholderType;
      size?: BlurSize;
    } = {},
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const imageSrc of imageSrcs) {
      result[imageSrc] = this.getBlurDataURL(imageSrc, options);
    }
    return result;
  }

  getProgressiveData(imageSrc: string, size: BlurSize = 'small') {
    return {
      color: this.getDominantColor(imageSrc),
      blur: this.getBlurDataURL(imageSrc, { size }),
      hasBlur: this.hasBlurHash(imageSrc),
    };
  }

  hasBlurHash(imageSrc: string): boolean {
    return Boolean(this.findBlurDataByPath(imageSrc));
  }

  getMetadata() {
    const cacheHitRate =
      this.metrics.totalRequests > 0
        ? (
            (this.metrics.cacheHits / this.metrics.totalRequests) *
            100
          ).toFixed(2)
        : '0.00';

    return {
      ...this.metadata,
      cacheSize: this.cache.size,
      metrics: {
        ...this.metrics,
        cacheHitRate: `${cacheHitRate}%`,
      },
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  getBlurHash(imageSrc: string): string | null {
    const data = this.findBlurDataByPath(imageSrc);
    return data?.hash || null;
  }

  preloadBlurData(imageSrcs: string[], size: BlurSize = 'small'): void {
    for (const imageSrc of imageSrcs) {
      this.getBlurDataURL(imageSrc, { size });
    }
  }

  async fetchBlurDataForImage(
    imageSrc: string,
    type: BlurPlaceholderType = 'default',
  ): Promise<string> {
    return Promise.resolve(this.getBlurDataURL(imageSrc, { type }));
  }

  getAvailableKeys(): string[] {
    return Object.keys(this.blurData);
  }

  findMatchingKeys(searchTerm: string): string[] {
    const lower = searchTerm.toLowerCase();
    return Object.keys(this.blurData).filter((key) =>
      key.toLowerCase().includes(lower),
    );
  }
}

export function createBlurService(options?: BlurServiceOptions): BlurService {
  return new BlurService(options);
}

export const blurService = new BlurService();
