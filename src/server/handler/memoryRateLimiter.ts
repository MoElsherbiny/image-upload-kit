import type {
  RateLimitContext,
  RateLimiter,
  RateLimitResult,
} from '../../types/rateLimit';

export interface MemoryRateLimiterOptions {
  /** Maximum number of allowed requests per key within `windowMs`. */
  limit: number;
  /** Fixed window duration in milliseconds. */
  windowMs: number;
  /** Maximum distinct keys retained in memory before oldest eviction (default `10_000`). */
  maxKeys?: number;
  /** Optional clock provider for deterministic testing (default `Date.now`). */
  now?: () => number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

/**
 * Single-instance in-memory fixed-window rate limiter.
 *
 * **Production limitation**: State lives in process memory only and is NOT shared
 * across multiple server instances, containers, or serverless/edge isolates.
 * Use this for local development, tests, or single-node deployments; for
 * multi-instance production deployments, implement `RateLimiter` backed by
 * Redis, Upstash, Cloudflare KV, or a shared database.
 */
export function createMemoryRateLimiter(
  options: MemoryRateLimiterOptions,
): RateLimiter {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1, Math.floor(options.windowMs));
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? 10_000));
  const getNow = options.now ?? (() => Date.now());
  const buckets = new Map<string, WindowEntry>();

  function pruneExpired(now: number): void {
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }

  return {
    consume(ctx: RateLimitContext): RateLimitResult {
      const now = getNow();
      const bucketKey = `${ctx.action}:${ctx.key}`;
      const existing = buckets.get(bucketKey);

      if (!existing || existing.resetAt <= now) {
        if (existing) {
          buckets.delete(bucketKey);
        } else if (buckets.size >= maxKeys) {
          pruneExpired(now);
          if (buckets.size >= maxKeys) {
            const oldest = buckets.keys().next().value;
            if (oldest !== undefined) buckets.delete(oldest);
          }
        }
        buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
        return {
          allowed: true,
          limit,
          remaining: Math.max(0, limit - 1),
        };
      }

      if (existing.count >= limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000),
        );
        return {
          allowed: false,
          limit,
          remaining: 0,
          retryAfterSeconds,
          reason: 'Rate limit exceeded',
        };
      }

      existing.count += 1;
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - existing.count),
      };
    },
  };
}
