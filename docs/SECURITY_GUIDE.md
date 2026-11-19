# Security Guide

`img-upload-kit` is security-first and framework-agnostic. Every upload boundary validates inputs defensively while leaving authentication and tenant policy in your application's control.

## 1. Application-Controlled `authorize` & `getSubject`

`createUploadHttpHandler` never couples to a specific auth library. Provide `authorize` to gate requests (`401` on `false` or throw) and `getSubject` to bind uploads, rate limits, quotas, and presigned tokens to the authenticated user or tenant.

```ts
import { createUploadHttpHandler } from 'img-upload-kit/server/handler';
import type { AuthorizeContext } from 'img-upload-kit/server/handler';

async function resolveSession(request: Request): Promise<{ userId: string; role: string } | null> {
  // Works with Auth.js, Clerk, Lucia, custom JWT cookies, or bearer tokens
  const sessionToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!sessionToken) return null;
  return verifySessionToken(sessionToken); // your application helper
}

export const { POST, DELETE } = createUploadHttpHandler({
  uploader,
  authorize: async (ctx: AuthorizeContext) => {
    const session = await resolveSession(ctx.request);
    if (!session) return false;
    if (ctx.action === 'delete') return session.role === 'admin';
    return true;
  },
  getSubject: async (ctx: AuthorizeContext) => {
    const session = await resolveSession(ctx.request);
    return session?.userId;
  },
  allowedPresets: ['avatar', 'card', 'hero'],
  allowedBuckets: ['user-media'],
});
```

> **Note:** Client-supplied FormData overrides (`folder`, `filename`, `dimensions`, `format`, `quality`, `aspectRatio`, `crop`) and `bucket` overrides are ignored by default unless explicitly opted in via `allowClientOverrides` / `allowClientBucketOverride`.

## 2. Presigned Upload Token Security

Two-phase presigned uploads (`?action=presign` -> direct storage PUT/POST -> `?action=finalize`) use stateless WebCrypto HMAC-SHA256 tokens (`signUploadToken` / `verifyUploadToken`).

### Key Protections
- **Secret rotation**: Pass `secret: [activeSecret, previousSecret]` (`UploadTokenSecret = string | readonly string[]`, minimum 16 characters each). New tokens are signed with the first secret; verification checks all secrets in constant time.
- **Clock skew tolerance**: Configure `clockToleranceMs` (default `0`) for distributed clock drift.
- **Subject (`sub`) ownership binding**: When `getSubject` returns a non-empty string on `presign`, `sub` is embedded in `PresignTokenPayload`. On `finalize`, the handler verifies signature/expiry (`consume: false`), runs `authorize`, verifies `tokenPayload.sub === currentSubject` (`403 FORBIDDEN` on mismatch), enforces rate limits, and **only then** atomically consumes `jti`. An unauthorized caller can never burn a victim's single-use token.
- **Single-use replay protection**: Without `tokenStore`, tokens are tracked in an in-memory `Map` (capped at 4,096 entries). **The in-memory store is for local development or single-instance deployments only** — it is not shared across containers, serverless functions, or edge isolates.

### Distributed `PresignTokenStore` (Redis Example)

```ts
import type { PresignTokenStore } from 'img-upload-kit/server/handler';

export function createRedisTokenStore(redis: {
  set(key: string, value: string, mode: 'PX', ttlMs: number, flag: 'NX'): Promise<string | null>;
}): PresignTokenStore {
  return {
    async consume(jti: string, expMs: number): Promise<boolean> {
      const ttlMs = Math.max(1_000, expMs - Date.now());
      const result = await redis.set(`iuk:jti:${jti}`, '1', 'PX', ttlMs, 'NX');
      return result === 'OK';
    },
  };
}
```

Pass it via `presigned`:

```ts
createUploadHttpHandler({
  uploader,
  getSubject,
  presigned: {
    secret: [process.env.UPLOAD_TOKEN_SECRET_CURRENT!, process.env.UPLOAD_TOKEN_SECRET_PREV!],
    expiresInSeconds: 300,
    clockToleranceMs: 5_000,
    tokenStore: createRedisTokenStore(redis),
  },
});
```

## 3. SVG Security

- **Disabled by default**: `allowSvg` defaults to `false` on both `createImageUploader` and presets.
- **Zero-dep XML tokenizer + strict allowlist**: When `allowSvg: true`, `sanitizeSvg` (`src/server/security/sanitizeSvg.ts`) parses the document with a strict XML tokenizer (`svgTokenizer.ts`) and allowlist (`svgAllowlist.ts`):
  - Rejects malformed XML, mismatched tags, and unclosed elements.
  - Strips `<!DOCTYPE>`, `<!ENTITY>`, XML comments, CDATA, processing instructions, `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, and external `<use>` references.
  - Strips `on*` event handlers, blocks `javascript:`, `vbscript:`, `data:text/*`, and `data:image/svg*` URIs, and sanitizes `<style>`/`style` CSS (`@import`, `expression()`, external `url()`).
  - Enforces `maxBytes` (default `1 MB`, `DEFAULT_MAX_SVG_BYTES`).
- **Custom sanitizer hook**: Plug in DOMPurify or organization-specific rules via `SanitizeSvgOptions.customSanitizer`:

```ts
import { sanitizeSvg } from 'img-upload-kit/server';

const cleanBuffer = sanitizeSvg(rawSvgBuffer, {
  maxBytes: 512 * 1024,
  customSanitizer: (svg) => myCustomPreprocessor(svg),
});
```

## 4. Image Resource Limits & Magic-Byte Sniffing

Every upload is inspected by `sniffImageFormat` / `assertMagicBytesAllowed` (magic bytes, never trusting client `Content-Type` or file extensions). Before full pixel decoding, `assertImageMetadataLimits` enforces configurable caps:

| Limit | Default (`DEFAULT_IMAGE_RESOURCE_LIMITS`) | Purpose |
| --- | ---: | --- |
| `maxWidth` | `16,384` px | Prevents extreme horizontal allocations |
| `maxHeight` | `16,384` px | Prevents extreme vertical allocations |
| `maxPixels` | `100,000,000` (100 MP; optimizer default `50,000,000`) | Mitigates decompression bombs |
| `maxFrames` | `120` frames | Mitigates animated GIF/WebP/AVIF CPU DoS |

```ts
import { assertImageMetadataLimits, optimizeImage } from 'img-upload-kit/server';

assertImageMetadataLimits(metadata, { maxWidth: 8192, maxHeight: 8192, maxPixels: 40_000_000, maxFrames: 60 });

const optimized = await optimizeImage(buffer, {
  maxWidth: 8192,
  maxHeight: 8192,
  limitInputPixels: 40_000_000,
  maxFrames: 60,
  preserveMetadata: false, // default: strips EXIF/GPS on all paths including JPEG passthrough
});
```

## 5. CORS/Origin, Body Caps, Rate Limiting & Error Redaction

- **`allowedOrigins`**: Pass `string[]` or `(origin: string) => boolean`. Requests with missing or disallowed `Origin`/`Referer` are rejected with `403`.
- **`maxBodyBytes`**: Enforced via `Content-Length` precheck and streaming byte cap (defaults to `1.25 × max(preset.maxSizeMB, defaultMaxSizeMB)`).
- **Rate limiting & quotas**: Implement provider-independent `RateLimiter` and `QuotaProvider` interfaces (from `img-upload-kit`) backed by Redis, Upstash, Cloudflare KV, or SQL. `createMemoryRateLimiter` (from `img-upload-kit/server/handler`) is provided for local dev/tests and single-instance servers only.

```ts
import { createMemoryRateLimiter, createUploadHttpHandler } from 'img-upload-kit/server/handler';

export const { POST, DELETE } = createUploadHttpHandler({
  uploader,
  allowedOrigins: ['https://app.example.com'],
  maxBodyBytes: 12 * 1024 * 1024,
  rateLimiter: createMemoryRateLimiter({ limit: 30, windowMs: 60_000 }), // dev/single-instance only
  rateLimitKey: (req, subject) => (subject ? `user:${subject}` : req.headers.get('x-forwarded-for') ?? 'anon'),
  onError: (err, ctx) => console.error(`[upload:${ctx.action}]`, err),
});
```

- **Error redaction**: All `UploadKitError` instances serialize via `toPublicJSON()`, exposing only `{ error, code, retryable, metadata? }`. Internal `cause` objects, storage SDK internals, and stack traces are never sent to clients and are forwarded exclusively to `onError` for server-side logging.
