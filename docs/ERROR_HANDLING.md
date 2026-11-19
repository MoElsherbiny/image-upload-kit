# Error Handling Guide

`img-upload-kit` standardizes errors across server handlers, storage adapters, and client uploaders via `UploadKitError` and `UploadErrorCode` (exported from the root package `img-upload-kit`).

## 1. Complete `UploadErrorCode` Reference

Default HTTP statuses and `retryable` flags are defined in `src/types/errors.ts`:

| `UploadErrorCode` | Default HTTP Status | Default `retryable` | When It Occurs |
| --- | ---: | :---: | --- |
| `FILE_TOO_LARGE` | `413` | `false` | File, SVG, or request body exceeds `maxSizeMB`, `maxBodyBytes`, or storage limit. |
| `INVALID_IMAGE` | `400` | `false` | Corrupted image, missing dimensions, invalid/malformed SVG, or invalid upload form input. |
| `UNSUPPORTED_FORMAT` | `400` | `false` | Magic bytes do not match an allowed format (or SVG uploaded while `allowSvg: false`). |
| `UNAUTHORIZED` | `401` | `false` | `authorize` returned `false`/threw, or storage backend rejected credentials. |
| `FORBIDDEN` | `403` | `false` | Disallowed `Origin`/`Referer`, token `sub` mismatch, path traversal, or storage access denied. |
| `UPLOAD_EXPIRED` | `400` | `false` | Presigned upload token passed `exp + clockToleranceMs`. |
| `INVALID_UPLOAD_TOKEN` | `400` (`409` on replay) | `false` | Malformed, bad-signature, invalid-claims, or already-consumed (`jti`) presigned token. |
| `RATE_LIMITED` | `429` | `true` | `RateLimiter` or `QuotaProvider` rejected request, or storage provider throttled (`SlowDown`). |
| `STORAGE_ERROR` | `502` (`400`/`404`/`409`/`504`) | `true` (default; `false` for 4xx) | Storage upload, download, delete, or network/integrity failure. |
| `PROCESSING_FAILED` | `500` | `false` | Unexpected Sharp optimization or image processing failure. |
| `UPLOAD_CANCELLED` | `499` | `false` | Caller aborted upload via `AbortSignal`. |
| `RESOURCE_LIMIT_EXCEEDED` | `503` (`400` for image caps) | `true` (default; `false` for dimension/frame caps) | Semaphore/concurrency saturation, storage quota/disk full, or `maxWidth`/`maxHeight`/`maxPixels`/`maxFrames` exceeded. |

## 2. Server `UploadKitError` & Redaction (`toPublicJSON()`)

`UploadKitError` keeps internal diagnostics (`cause`, stack trace) on the server while serializing only safe fields to clients via `toPublicJSON()`:

```ts
import { UploadKitError } from 'img-upload-kit';

const err = new UploadKitError('Upload rate limit exceeded', {
  code: 'RATE_LIMITED',
  status: 429,
  retryable: true,
  metadata: { retryAfterSeconds: 30 },
  cause: internalRedisError, // preserved server-side only; NEVER sent to clients
});

err.toPublicJSON();
// => { error: 'Upload rate limit exceeded', code: 'RATE_LIMITED', retryable: true, metadata: { retryAfterSeconds: 30 } }
```

### Automatic Handler Serialization
In `createUploadHttpHandler` (`src/server/handler/responses.ts`):
- `errorResponseFromKitError(error)` responds with `error.toPublicJSON()` and `error.status`, preserving `{ error: string }` for backward compatibility while adding `{ code, retryable, metadata? }`.
- If `error.metadata?.retryAfterSeconds` is a positive number, the handler automatically attaches the `Retry-After` HTTP header.
- Errors with `status >= 500` and unexpected non-`UploadKitError` exceptions are forwarded to your `onError(error, ctx)` callback; clients receive a redacted `{ error: 'Internal server error' }` (`500`).
- Storage adapters wrap provider SDK failures with `normalizeStorageError(err, ctx)` so AWS/Supabase/OS error internals are never leaked.

```ts
import { createUploadHttpHandler } from 'img-upload-kit/server/handler';

export const { POST, DELETE } = createUploadHttpHandler({
  uploader,
  onError: (error, ctx) => {
    logger.error({ action: ctx.action, url: ctx.request.url, err: error }, 'Upload handler failure');
  },
});
```

## 3. Client Error Handling & Retry Patterns

Use `isUploadKitError`, `isRetryableUploadError` (from `img-upload-kit`), and `isUploadAbortError` (from `img-upload-kit/client`) to separate cancellations, terminal validation errors, and transient retryable failures.

```ts
import { isRetryableUploadError, isUploadKitError, type SerializedUploadError } from 'img-upload-kit';
import { isUploadAbortError, uploadAsset } from 'img-upload-kit/client';

async function uploadWithRetry(file: File, signal?: AbortSignal) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await uploadAsset(file, { preset: 'card' }, { endpoint: '/api/upload', signal });
    } catch (err) {
      if (isUploadAbortError(err)) {
        throw err; // User cancelled — never retry
      }

      const retryable = isRetryableUploadError(err) || isTransientMessage(err);
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }

      const retryAfterSec =
        isUploadKitError(err) && typeof err.metadata?.retryAfterSeconds === 'number'
          ? err.metadata.retryAfterSeconds
          : undefined;
      const backoffMs = retryAfterSec
        ? retryAfterSec * 1000
        : Math.min(8_000, 300 * 2 ** (attempt - 1) + Math.random() * 250);

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new Error('Upload failed after retries');
}

function isTransientMessage(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : '';
  return /\(status (429|502|503|504)\)/.test(msg);
}
```

### Handling Structured Responses from Custom `fetch` Calls

When calling the endpoint directly with `fetch` (for example in custom headless flows), parse the `SerializedUploadError` payload and branch on `code` and `retryable`:

```ts
const res = await fetch('/api/upload', { method: 'POST', body: formData });
if (!res.ok) {
  const payload = (await res.json()) as Partial<SerializedUploadError>;
  if (payload.code === 'UNAUTHORIZED') {
    redirectToLogin();
  } else if (payload.code === 'FILE_TOO_LARGE') {
    showToast('Please choose an image smaller than the upload limit.');
  } else if (payload.retryable) {
    scheduleRetry(Number(res.headers.get('Retry-After')) || 2);
  }
}
```
