import type { OptimizedImageResult, OptimizeImageOptions } from './types';

export interface TransformCache {
  get(
    key: string,
  ): OptimizedImageResult | undefined | Promise<OptimizedImageResult | undefined>;
  set(key: string, value: OptimizedImageResult): void | Promise<void>;
  delete?(key: string): boolean | void | Promise<boolean | void>;
  clear?(): void | Promise<void>;
}

export interface MemoryTransformCacheOptions {
  /** Maximum number of cached transform results before LRU eviction. Defaults to `100`. */
  maxEntries?: number;
  /** Optional total byte budget across cached buffers. */
  maxBytes?: number;
  /** Optional time-to-live in milliseconds for each cache entry. */
  ttlMs?: number;
}

export interface MemoryTransformCache extends TransformCache {
  get(key: string): OptimizedImageResult | undefined;
  set(key: string, value: OptimizedImageResult): void;
  delete(key: string): boolean;
  clear(): void;
  readonly size: number;
  readonly totalBytes: number;
}

interface CacheEntry {
  value: OptimizedImageResult;
  bytes: number;
  expiresAt?: number;
}

/**
 * Builds a deterministic cache key from an image content hash and optimization options.
 */
export function buildTransformCacheKey(
  contentHash: string,
  options: OptimizeImageOptions = {},
): string {
  const parts = [
    contentHash.trim(),
    options.maxDimensions
      ? `${options.maxDimensions.width}x${options.maxDimensions.height}`
      : 'default-dim',
    options.aspectRatio !== undefined ? `ar:${String(options.aspectRatio)}` : 'ar:none',
    options.crop ? `crop:${options.crop}` : 'crop:default',
    options.focalPoint
      ? `fp:${options.focalPoint.x.toFixed(4)},${options.focalPoint.y.toFixed(4)}`
      : 'fp:none',
    options.outputFormat ? `fmt:${options.outputFormat}` : 'fmt:auto',
    options.quality !== undefined ? `q:${options.quality}` : 'q:auto',
    options.effort !== undefined ? `e:${options.effort}` : 'e:default',
    options.colorSpace ? `cs:${options.colorSpace}` : 'cs:preserve',
    options.preserveMetadata ? 'meta:keep' : 'meta:strip',
  ];
  return parts.join('|');
}

/**
 * Bounded in-memory LRU cache for `OptimizedImageResult` transform outputs.
 */
export function createMemoryTransformCache(
  options: MemoryTransformCacheOptions = {},
): MemoryTransformCache {
  const maxEntries = Math.max(1, options.maxEntries ?? 100);
  const maxBytes = options.maxBytes;
  const ttlMs = options.ttlMs;
  const entries = new Map<string, CacheEntry>();
  let totalBytes = 0;

  const removeEntry = (key: string): boolean => {
    const existing = entries.get(key);
    if (!existing) return false;
    totalBytes -= existing.bytes;
    return entries.delete(key);
  };

  const evictIfNeeded = () => {
    while (
      entries.size > maxEntries ||
      (maxBytes !== undefined && totalBytes > maxBytes && entries.size > 0)
    ) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      removeEntry(oldestKey);
    }
  };

  return {
    get(key: string): OptimizedImageResult | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
        removeEntry(key);
        return undefined;
      }
      // Refresh LRU order
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },

    set(key: string, value: OptimizedImageResult): void {
      removeEntry(key);
      const bytes = value.buffer.byteLength;
      if (maxBytes !== undefined && bytes > maxBytes) {
        return;
      }
      entries.set(key, {
        value,
        bytes,
        ...(ttlMs !== undefined ? { expiresAt: Date.now() + ttlMs } : {}),
      });
      totalBytes += bytes;
      evictIfNeeded();
    },

    delete(key: string): boolean {
      return removeEntry(key);
    },

    clear(): void {
      entries.clear();
      totalBytes = 0;
    },

    get size(): number {
      return entries.size;
    },

    get totalBytes(): number {
      return totalBytes;
    },
  };
}
