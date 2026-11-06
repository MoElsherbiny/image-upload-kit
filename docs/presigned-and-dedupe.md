# Client-Side Resize, Presigned Uploads & Content-Hash Deduplication

`img-upload-kit` v2.2+ includes three end-to-end bandwidth, serverless, and storage optimizations that work across **React**, **Vue 3 / Nuxt 4**, **Angular 17–21+**, and **React Native / Expo**.

---

## 1. Client-Side Pre-Upload Resize (`createClientResizeTransform`)

Modern smartphones capture 24–48 MP photos (8–20 MB) that waste mobile upload bandwidth and risk hitting serverless payload limits. `createClientResizeTransform` downscales oversized raster images in the browser using `createImageBitmap` (`imageOrientation: 'from-image'`) + `OffscreenCanvas` before network transmission, while preserving server-side Sharp AVIF/WebP encoding, LQIP, BlurHash, and 4-edge color extraction.

- **100% SSR & Worker Safe**: Zero DOM globals (`document.createElement`) at import time.
- **Smart Bypass**: Automatically skips SVGs (`image/svg+xml`), GIFs (`image/gif`), images already within `maxWidth x maxHeight`, and files smaller than `skipBelowBytes`.
- **Composable**: Chain with custom croppers or watermarks via `composeTransforms(...)` while honoring `AbortSignal` between steps.

### Web (React, Vue, Angular)

```ts
import { composeTransforms, createClientResizeTransform } from 'img-upload-kit/client';

export const resizeBeforeUpload = createClientResizeTransform({
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 0.9,
  mimeType: 'image/webp',      // Automatically falls back to 'image/jpeg' if unsupported
  skipBelowBytes: 350 * 1024,  // Skip resize for files already < 350 KB
});

// Chain multiple pre-upload transforms with automatic AbortSignal checks:
export const uploadPipeline = composeTransforms(
  resizeBeforeUpload,
  async (file, { signal }) => {
    // Optional second pass (e.g. custom filename or watermark)
    return file;
  },
);
```

Pass `transformAsset={resizeBeforeUpload}` to `<SingleImageUpload>`, `<MultiImageUpload>`, `useSingleUpload`, `createSingleUpload`, or `useMultiUpload`.

### React Native & Expo (`createExpoManipulatorResizeTransform`)

On iOS and Android, use `createExpoManipulatorResizeTransform` with `expo-image-manipulator`:

```tsx
import * as ImageManipulator from 'expo-image-manipulator';
import {
  createExpoManipulatorResizeTransform,
  SingleImageUpload,
} from 'img-upload-kit/react-native';

const nativeResize = createExpoManipulatorResizeTransform(ImageManipulator, {
  maxWidth: 2048,
  maxHeight: 2048,
  compress: 0.9,
  format: 'jpeg',
});

export function ProfilePhotoField() {
  return <SingleImageUpload preset="avatar" transformAsset={nativeResize} />;
}
```

---

## 2. Content-Hash Deduplication (`deduplicate` & `createMemoryDedupeStore`)

When users upload the exact same image multiple times, content-hash deduplication avoids redundant Sharp encoding and duplicate storage objects while scoping keys safely by preset and output parameters.

### How Composite Deduplication Keys Work

`createImageUploader` computes a composite SHA-256 key from:
1. The raw input binary SHA-256 hash (`rawContentHash`)
2. Target `bucket`, `preset`, `folder`, `outputFormat`, `quality`, `maxDimensions`, `aspectRatio`, `crop`, and `variantWidths`

Uploading the same photo to `avatar` (`512x512`, `1:1`) and `hero` (`2560x1440`, `16:9`) produces distinct composite keys so presets never collide, while uploading the identical file twice to the same preset returns the existing `UploadedImageData` with `deduplicated: true`.

### Server Configuration

```ts
import {
  createImageUploader,
  createMemoryDedupeStore,
  type DedupeStore, // Also exported as alias `ImageDedupeStore`
} from 'img-upload-kit/server';

// 1. Built-in LRU in-memory store (single-process / edge):
const memoryDedupeStore = createMemoryDedupeStore({ maxEntries: 2000 });

// 2. Or plug in Redis / Postgres / KV for multi-instance deployments:
const redisDedupeStore: DedupeStore = {
  async get(key) {
    const raw = await redis.get(`iuk:dedupe:${key}`);
    return raw ? JSON.parse(raw) : null;
  },
  async set(key, data) {
    await redis.set(`iuk:dedupe:${key}`, JSON.stringify(data), 'EX', 60 * 60 * 24 * 30);
  },
  async delete(key) {
    await redis.del(`iuk:dedupe:${key}`);
  },
};

export const uploader = createImageUploader({
  storage,
  defaultBucket: 'media',
  deduplicate: {
    store: memoryDedupeStore,
    verifyExists: true, // Calls storage.exists(bucket, path) when supported before reusing
  },
});

const result = await uploader.uploadImage(file, { preset: 'square' });
console.log(result.deduplicated); // true on cache hit, false on fresh encode
```

---

## 3. Presigned Direct-to-Storage Uploads (`uploadMode: 'presigned'`)

Serverless platforms (such as Vercel Functions or AWS Lambda) enforce strict request body limits (e.g. `4.5 MB`). Presigned mode uploads the raw (or client-resized) asset directly to S3, Cloudflare R2, or Supabase Storage, then finalizes optimization on the server:

```
Client                          Server (/api/upload)                Object Storage (S3/R2)
  |-- 1. POST ?action=presign ------->|                                       |
  |<---- { upload, token } -----------| (HMAC-SHA256 signed staging token)    |
  |-- 2. PUT/POST raw bytes (0-85%) ----------------------------------------->|
  |-- 3. POST ?action=finalize ------>|-- download staged -> sniff & Sharp -->|
  |                                   |-- upload final AVIF + variants ------>|
  |<---- UploadedImageData (100%) ----|-- delete staged object -------------->|
```

### Step 1: Configure `StorageAdapter` (`createPresignedUpload` & `download`)

`createS3StorageAdapter`, `createSupabaseStorageAdapter`, and `createMemoryStorageAdapter` implement both `createPresignedUpload` and `download`, while `createLocalFsStorageAdapter` implements `download` and `stat`:

```ts
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createS3StorageAdapter } from 'img-upload-kit/storage';

export const storage = createS3StorageAdapter({
  publicBaseUrl: 'https://cdn.example.com',
  defaultBucket: 'media',
  putObject: (input) => s3.send(new PutObjectCommand(input)),
  deleteObject: (input) => s3.send(new DeleteObjectCommand(input)),
  headObject: (input) => s3.send(new HeadObjectCommand(input)),
  // Returns { Body }, which createS3StorageAdapter reads and bounds by maxBytes:
  getObject: (input) => s3.send(new GetObjectCommand(input)),
  presignUpload: async ({ bucket, path, contentType, expiresInSeconds }) => {
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: bucket, Key: path, ContentType: contentType }),
      { expiresIn: expiresInSeconds ?? 300 },
    );
    return { method: 'PUT', url, headers: { 'content-type': contentType } };
  },
});
```

> **Tip — Storage Size Caps & Orphaned Staging Cleanup**:
> - **Enforce size limits at the storage layer**: In `presignUpload`, you can use `@aws-sdk/s3-presigned-post` (`createPresignedPost(s3, { Bucket: bucket, Key: path, Conditions: [['content-length-range', 1, maxBytes]], Fields: { 'Content-Type': contentType }, Expires: expiresInSeconds ?? 300 })`) and return `{ method: 'POST', url, fields }`. On finalize, `createS3StorageAdapter` also checks `headObject` (`ContentLength`) and enforces `maxBytes` during stream download before buffering into RAM.
> - **Expire abandoned `_staging/` objects**: Configure an S3 / Cloudflare R2 bucket lifecycle expiration rule on the `_staging/` prefix (e.g. expire after 1 day), and/or schedule `sweepStagedUploads(storage, { bucket: 'media', stagingPrefix: '_staging/', maxAgeMs: 3600_000 })` from `'img-upload-kit/server'` for defense-in-depth cleanup.

### Step 2: Enable `presigned` on `createUploadHttpHandler`

```ts
import { createUploadHttpHandler, sweepStagedUploads } from 'img-upload-kit/server';

export const { POST, DELETE } = createUploadHttpHandler({
  uploader,
  presigned: {
    secret: process.env.UPLOAD_PRESIGN_SECRET!, // >= 16 chars HMAC-SHA256 secret
    expiresInSeconds: 300,
    stagingPrefix: '_staging',
    // Optional distributed replay store (Redis / KV) for multi-instance deployments:
    // tokenStore: {
    //   consume: async (jti, ttlMs) => (await redis.set(`iuk:jti:${jti}`, '1', 'PX', ttlMs, 'NX')) === 'OK',
    // },
  },
});
```

### Step 3: Set `uploadMode="presigned"` on Any Client

```tsx
// React (<ImageUploadProvider> or per-component):
<SingleImageUpload
  endpoint="/api/upload"
  uploadMode="presigned"
  preset="hero"
  value={hero}
  onChange={setHero}
/>
```

Or call `uploadViaPresignedUrl(endpoint, file, { preset: 'hero' }, { onUploadProgress })` directly from `img-upload-kit/client`.
