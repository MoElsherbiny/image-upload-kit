import type { ImageUploader } from '../uploadService';

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
   * Hook invoked when an unexpected 500 internal error occurs. Raw error details are never sent to clients.
   */
  onError?: (error: unknown, ctx: UploadErrorContext) => void;
}
