import type { QuotaProvider, RateLimiter } from '../../types/rateLimit';
import type { ImageUploader } from '../uploadService';
import type { PresignTokenStore, UploadTokenSecret } from './uploadToken';

export interface AuthorizeContext {
  action: 'upload' | 'delete';
  request: Request;
  path?: string;
  bucket?: string;
  preset?: string;
}

export interface AllowClientOverrides {
  /** Allow client `customFilename` field (always sanitized, forced to output extension, never upserted). */
  filename?: boolean;
  /**
   * Allow client `folder` field. Pass `true` to accept sanitized folder names, or a callback
   * `(folder, ctx) => string | null` that returns the scoped folder (or `null` to reject with 400).
   */
  folder?:
    | boolean
    | ((folder: string, ctx: AuthorizeContext) => string | null | undefined);
  /** Allow client `maxWidth` / `maxHeight` fields (clamped to the active preset's `maxDimensions`). */
  dimensions?: boolean;
  /** Allow client `outputFormat` field (`jpeg`, `png`, `webp`, `avif`). */
  format?: boolean;
  /** Allow client `quality` field (1–100, clamped to the active preset's `quality` when set). */
  quality?: boolean;
  /** Allow client `aspectRatio` and `crop` fields. */
  aspectRatio?: boolean;
  /** Allow client `crop` field (`'attention' | 'entropy' | 'center'`). */
  crop?: boolean;
}

export type ClientOverridesConfig = AllowClientOverrides;

export interface PresignedHandlerOptions {
  /**
   * HMAC-SHA256 secret (or rotation array `[activeSecret, ...previousSecrets]`)
   * used to sign and verify stateless presign tokens (minimum 16 characters each).
   */
  secret: UploadTokenSecret;
  /** Optional bucket for temporary staging objects (defaults to resolved target bucket) */
  stagingBucket?: string;
  /** Prefix inside the staging bucket for temporary objects (defaults to `'_staging/'`) */
  stagingPrefix?: string;
  /** Token and presigned URL TTL in seconds (defaults to `300` = 5 minutes) */
  expiresInSeconds?: number;
  /** Optional clock skew tolerance in milliseconds when verifying token expiration (defaults to `0`) */
  clockToleranceMs?: number;
  /** Optional atomic replay store (e.g. Redis SET NX PX) for multi-instance deployments */
  tokenStore?: PresignTokenStore;
}

export interface UploadErrorContext {
  action: 'upload' | 'delete';
  request: Request;
}

export interface UploadHttpHandlerOptions<TPreset extends string = string> {
  uploader: ImageUploader<TPreset>;
  /**
   * Optional authorization check. Return `false` or throw to reject with 401.
   */
  authorize?: (ctx: AuthorizeContext) => boolean | Promise<boolean>;
  /**
   * Optional resolver returning the authenticated user/tenant identifier for
   * presigned token subject (`sub`) binding, rate-limit keying, and quota enforcement.
   */
  getSubject?: (
    ctx: AuthorizeContext,
  ) => string | undefined | Promise<string | undefined>;
  /**
   * Optional whitelist of allowed preset names.
   */
  allowedPresets?: TPreset[];
  /**
   * Optional CSRF/CORS origin allowlist (`string[]` of origins or predicate).
   * When set, requests with a missing or disallowed `Origin`/`Referer` are rejected with 403.
   */
  allowedOrigins?: string[] | ((origin: string) => boolean);
  /**
   * Maximum allowed request body size in bytes (enforced via Content-Length precheck and stream cap).
   * Defaults to `1.25 × max(preset.maxSizeMB, defaultMaxSizeMB)` (minimum 1 MB when unset).
   */
  maxBodyBytes?: number;
  /**
   * Opt-in switches for client-supplied FormData overrides. All default to `false` (ignored).
   */
  allowClientOverrides?: AllowClientOverrides | boolean;
  /**
   * Allow clients to override `bucket` via FormData or DELETE query params. Defaults to `false`.
   */
  allowClientBucketOverride?: boolean;
  /**
   * Optional explicit allowlist of bucket names permitted for upload and delete operations.
   */
  allowedBuckets?: string[];
  /**
   * Optional two-phase presigned upload configuration (`?action=presign` & `?action=finalize`).
   */
  presigned?: PresignedHandlerOptions;
  /**
   * Optional provider-independent rate limiter applied to `POST`, `presign`, `finalize`, and `DELETE`.
   */
  rateLimiter?: RateLimiter;
  /**
   * Optional per-user/tenant storage quota provider enforced on `POST`, `presign`, and `finalize`.
   */
  quotaProvider?: QuotaProvider;
  /**
   * Optional custom key extractor for rate limiting. Defaults to `sub:<subject>` or client IP.
   */
  rateLimitKey?: (req: Request, subject?: string) => string;
  /**
   * Hook invoked when an unexpected 500 internal error occurs. Raw error details are never sent to clients.
   */
  onError?: (error: unknown, ctx: UploadErrorContext) => void;
}
