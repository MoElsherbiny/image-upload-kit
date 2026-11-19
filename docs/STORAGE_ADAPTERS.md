# Storage Adapters

`img-upload-kit/storage` provides zero-dependency built-in adapters, a normalized error layer, resumable cross-provider migration, and a strict `StorageAdapter` contract for custom cloud backends.

## 1. Provider Support Policy

| Support Tier | Providers | How to Integrate |
| --- | --- | --- |
| **Official Native** | **LocalFS**, **AWS S3**, **Supabase Storage**, **Memory** | Built-in factories: `createLocalFsStorageAdapter`, `createS3StorageAdapter`, `createSupabaseStorageAdapter`, `createMemoryStorageAdapter` |
| **Verified S3-Compatible** | **Cloudflare R2**, **MinIO**, **DigitalOcean Spaces**, **Backblaze B2** | Use `createS3StorageAdapter` with an S3-compatible SDK client/transport and provider endpoint |
| **Custom `StorageAdapter` Required** | **Google Cloud Storage (GCS)**, **Azure Blob Storage**, **Firebase Storage** | Implement `StorageAdapter` using `createStorageAdapter(...)` (blueprint below) |

## 2. Security Responsibilities & Limitations

All built-in adapters enforce `sanitizeStorageKey` (blocking `\0`, `.`, and `..` segments) and `validateStorageMetadata` (printable ASCII only, `<= 2,048` bytes total to prevent header/CRLF injection).

| Adapter | Built-in Protections | Operator Responsibilities & Limitations |
| --- | --- | --- |
| **LocalFS** (`createLocalFsStorageAdapter`) | Rejects `:` / `\0` / `..`; verifies `fs.realpath` containment to block symlink escapes. | Serve uploads from a dedicated static path with `X-Content-Type-Options: nosniff`; unsuitable for ephemeral/serverless filesystems; no presigned upload/download URLs. |
| **S3 & S3-Compatible** (`createS3StorageAdapter`) | Key traversal rejection, `IfNoneMatch: '*'` when `upsert: false`, normalized `UploadKitError` codes. | Scope IAM credentials to specific bucket prefixes; configure bucket CORS for browser presigned PUTs; enable lifecycle rules to sweep `_staging/` objects. |
| **Supabase** (`createSupabaseStorageAdapter`) | Key traversal rejection, metadata validation, normalized `UploadKitError` codes, signed upload/download support. | Keep the service-role key strictly server-side; configure RLS policies and bucket public/private visibility appropriately. |
| **Memory** (`createMemoryStorageAdapter`) | Enforces `sanitizeStorageKey` (rejecting `\0`, `.`, `..` across all read/write/presign/multipart ops) and `validateStorageMetadata` in a process-local `Map`. | **Development and unit testing only** — data is volatile and not shared across instances. |

### Cancellation (`signal`) & Normalized Errors

- **`StorageUploadParams.signal?: AbortSignal`**: Passed from `createImageUploader` (and forwarded as `abortSignal` by `createS3StorageAdapter`) so cancelled requests abort in-flight transport writes cleanly and roll back written objects.
- **Normalized `UploadKitError` (`normalizeStorageError`)**: Built-in adapters wrap SDK and OS failures across `upload`, `delete`, `download`, and `deleteByUrl` into safe `UploadKitError` codes (`STORAGE_ERROR`, `RATE_LIMITED`, `FORBIDDEN`, `RESOURCE_LIMIT_EXCEEDED`, `FILE_TOO_LARGE`) without leaking credentials, filesystem paths, or stack traces.

## 3. Health Checks, Presigned Downloads & Multipart Hooks

### Connectivity Probe (`healthCheck`)
Built-in adapters implement `healthCheck(): Promise<StorageHealthCheckResult>` returning `{ ok, latencyMs, message? }`:

```ts
const health = await storage.healthCheck?.();
if (!health?.ok) {
  console.error('Storage unhealthy:', health?.message);
}
```

### Private Object Signed Downloads (`createPresignedDownload`)
S3 (when `signGetObject` is configured) and Supabase adapters support short-lived signed download URLs for private buckets:

```ts
const { url, expiresAt } = await storage.createPresignedDownload!('private-media', 'docs/scan.avif', {
  expiresInSeconds: 120,
});
```

### Multipart Upload Hooks
`StorageAdapter` exposes optional multipart primitives implemented by `createS3StorageAdapter` (when your S3 transport provides `createMultipartUpload`, `uploadPart`, `completeMultipartUpload`, and `abortMultipartUpload`):

- `createMultipartUpload(params)` -> `{ uploadId, bucket, path }`
- `uploadPart(params)` -> `{ partNumber, etag }`
- `completeMultipartUpload(params)` -> `{ bucket, path, url }`
- `abortMultipartUpload(params)` -> `Promise<void>`

When exposing HTTP multipart uploads via `createMultipartUploadHandler`, hardened defaults apply automatically: keys are **server-generated** (`allowClientPathOverride` defaults to `false`), allowed MIME types are restricted to **image-only formats** (never `application/octet-stream` by default), total upload size is bounded by a **`100 MB` default `maxTotalBytes`** cap (with accurate byte replacement on re-uploaded part numbers), and **`validateOnComplete: true`** inspects assembled object magic bytes (and deletes invalid objects) before completion succeeds.

## 4. Resumable Storage Migration (`migrateStorage`)

`migrateStorage` copies objects between any two `StorageAdapter` instances with cursor pagination, dry-run planning, SHA-256 post-copy integrity verification, and guarded source deletion.

```ts
import { migrateStorage } from 'img-upload-kit/storage';

// 1. Safe dry-run preview
const preview = await migrateStorage({
  source: localStorageAdapter,
  target: s3StorageAdapter,
  sourceBucket: 'images',
  targetBucket: 'prod-images',
  folder: 'avatars',
  limit: 100,
  dryRun: true,
});

// 2. Resumable verified copy (retains source by default)
let cursor: string | undefined;
do {
  const page = await migrateStorage({
    source: localStorageAdapter,
    target: s3StorageAdapter,
    sourceBucket: 'images',
    targetBucket: 'prod-images',
    cursor,
    limit: 100,
    verifyIntegrity: true, // downloads target and compares SHA-256
    onProgress: (p) => console.log(`${p.copied} copied, ${p.skipped} skipped, ${p.failed} failed`),
  });
  cursor = page.nextCursor;
} while (cursor);
```

> **Safe source retention**: `deleteSource: true` is refused with `400 FORBIDDEN` unless `confirmDestructive: true` is also explicitly passed. Source objects are only deleted after upload (and SHA-256 verification when enabled) succeeds.

## 5. Custom `StorageAdapter` Blueprint (TypeScript)

Use `createStorageAdapter`, `sanitizeStorageKey`, `validateStorageMetadata`, `toPaginatedListResult`, and `normalizeStorageError` from `img-upload-kit/storage` for GCS, Azure Blob Storage, Firebase Storage, or proprietary object stores:

```ts
import {
  createStorageAdapter,
  normalizeStorageError,
  sanitizeStorageKey,
  toPaginatedListResult,
  validateStorageMetadata,
  type StorageAdapter,
} from 'img-upload-kit/storage';

export function createCustomCloudAdapter(client: YourCloudSdkClient): StorageAdapter {
  const provider = 'custom-cloud';

  return createStorageAdapter({
    async upload(params) {
      const key = sanitizeStorageKey(params.path, provider);
      validateStorageMetadata(params.metadata);
      try {
        await client.put(params.bucket, key, params.data, {
          contentType: params.contentType,
          cacheControl: params.cacheControl,
          metadata: params.metadata,
        });
        return { bucket: params.bucket, path: key, url: client.publicUrl(params.bucket, key) };
      } catch (err) {
        throw normalizeStorageError(err, { provider, operation: 'upload', bucket: params.bucket, path: key });
      }
    },

    async delete(bucket, rawPath) {
      const key = sanitizeStorageKey(rawPath, provider);
      try {
        await client.remove(bucket, key);
      } catch (err) {
        throw normalizeStorageError(err, { provider, operation: 'delete', bucket, path: key });
      }
    },

    async exists(bucket, rawPath) {
      return client.head(bucket, sanitizeStorageKey(rawPath, provider));
    },

    async download(bucket, rawPath, options) {
      const key = sanitizeStorageKey(rawPath, provider);
      const bytes = await client.getBytes(bucket, key);
      if (options?.maxBytes && bytes.byteLength > options.maxBytes) {
        throw normalizeStorageError({ status: 413 }, { provider, operation: 'download', bucket, path: key });
      }
      return bytes;
    },

    async list(bucket, folder, options) {
      const page = await client.listObjects(bucket, { prefix: folder, cursor: options?.cursor, limit: options?.limit });
      return toPaginatedListResult(
        page.entries.map((e) => ({ name: e.name, size: e.size, createdAt: e.createdAt })),
        page.nextCursor,
      );
    },

    async healthCheck() {
      const start = performance.now();
      try {
        await client.ping();
        return { ok: true, latencyMs: Math.round(performance.now() - start) };
      } catch (err) {
        return { ok: false, latencyMs: Math.round(performance.now() - start), message: String(err) };
      }
    },
  });
}
```
