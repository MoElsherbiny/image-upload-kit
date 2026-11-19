export interface RateLimitContext {
  action: 'upload' | 'delete' | 'presign' | 'finalize';
  key: string;
  subject?: string;
  bucket?: string;
  preset?: string;
  contentLength?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit?: number;
  remaining?: number;
  retryAfterSeconds?: number;
  reason?: string;
}

/**
 * Provider-independent rate limiter interface.
 * Implement with Redis, Upstash, Cloudflare KV, or SQL for multi-instance deployments.
 */
export interface RateLimiter {
  consume(ctx: RateLimitContext): Promise<RateLimitResult> | RateLimitResult;
}

export interface QuotaContext {
  action: 'upload' | 'presign' | 'finalize';
  subject: string;
  bytes: number;
  bucket?: string;
  preset?: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  remainingBytes?: number;
  remainingUploads?: number;
  retryAfterSeconds?: number;
}

/**
 * Provider-independent per-user/tenant quota interface for storage bytes,
 * daily upload counts, and concurrent upload limits.
 */
export interface QuotaProvider {
  check(ctx: QuotaContext): Promise<QuotaCheckResult> | QuotaCheckResult;
  recordUsage?(ctx: QuotaContext): Promise<void> | void;
}
