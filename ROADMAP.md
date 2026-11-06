# Roadmap — Post-v2.0 Planned Features

This document tracks features intentionally deferred from the `img-upload-kit` **v2.0.0** release so the core package stays lean, zero-lock-in, and well-tested. Contributions and RFC feedback are welcome.

---

## 1. Drag-to-Reorder Tiles (`v2.1`)

- **Goal**: Allow users to reorder uploaded images inside `<MultiImageUpload>` and `<HeadlessMultiUpload>` via pointer drag-and-drop and keyboard (`Space` + Arrow keys) without requiring a heavy external DnD library.
- **Proposed API**:
  - `reorderable?: boolean` on `MultiImageUploadProps` and `UseMultiUploadOptions`.
  - `move(fromIndex: number, toIndex: number): void` on `MultiUploadController`.
  - Accessible live announcements (`"Moved image 2 to position 1 of 5"`).

---

## 2. Client-Side Pre-Upload Canvas Resize (`v2.1`)

- **Goal**: Downscale oversized camera photos (e.g. 48 MP mobile captures) in the browser using `createImageBitmap` + `OffscreenCanvas` (or `<canvas>`) before transmitting bytes over the network, while still running server-side Sharp AVIF/WebP optimization and LQIP generation.
- **Proposed API**:
  - `clientMaxDimensions?: { width: number; height: number }` on `BaseImageUploadProps`.
  - Preserves EXIF orientation via modern browser `imageOrientation: 'from-image'`.

---

## 3. Presigned / Direct-to-Storage Uploads (`v2.2`)

- **Goal**: Bypass serverless request body limits (e.g. 4.5 MB on Vercel Functions) by uploading raw or pre-resized files directly to S3/R2/Supabase via presigned PUT/POST URLs, followed by an asynchronous or webhook-triggered processing pass.
- **Proposed API**:
  - `StorageAdapter.createPresignedUpload?(params)` optional method.
  - `createPresignedUploadHandler({ uploader, authorize })` server route helper.
  - Built-in client support in `useImageUpload` for two-step presign + finalize flows.

---

## 4. Content-Hash Deduplication (`v2.2`)

- **Goal**: Avoid storing duplicate objects when the exact same image (`contentHash`) is uploaded multiple times to the same bucket/preset.
- **Proposed API**:
  - `deduplicateByHash?: boolean` on `UploadPresetConfig` and `ImageUploaderOptions`.
  - Optional lookup hook `findExistingByHash?: (hash: string, ctx: { bucket: string; preset?: string }) => Promise<UploadedImageData | null>`.

---

## 5. Animated GIF & Animated WebP Preservation (`v2.2`)

- **Goal**: Preserve multi-frame animations when uploading GIF or animated WebP assets instead of flattening to a single frame.
- **Proposed API**:
  - `animated?: boolean | 'preserve'` on `UploadPresetConfig` and `ImageUploadOptions`.
  - Passes `{ animated: true }` to `sharp(buffer, { animated: true })` and encodes to animated WebP or AVIF sequence when multi-page input is detected (`metadata.pages > 1`).

---

## 6. Additional Storage Adapters (`v2.3`)

- **Goal**: Expand first-party `StorageAdapter` implementations beyond AWS S3 / Cloudflare R2 / MinIO, Supabase Storage, Local Filesystem, and In-Memory:
  - **Vercel Blob** (`createVercelBlobAdapter`)
  - **Google Cloud Storage** (`createGcsStorageAdapter`)
  - **Azure Blob Storage** (`createAzureBlobAdapter`)
  - **Cloudinary** (`createCloudinaryAdapter`)

---

## 7. Interactive Crop, Rotate & Aspect-Ratio Editor (`v2.4`)

- **Goal**: Optional modal step before upload (especially for `avatar`, `cover`, and `card` presets) allowing users to pan, zoom, rotate 90°, and lock aspect ratios (`1:1`, `16:9`, `4:3`, freeform).
- **Proposed API**:
  - Shipped as an opt-in subpath (`img-upload-kit/crop`) to keep `img-upload-kit/react` bundle size minimal.
  - Pluggable into `<SingleImageUpload>` and `<MultiImageUpload>` via a `transformFile?: (file: File) => Promise<File>` hook.
