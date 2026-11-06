# Roadmap — Post-v2.1 Planned Features

This document tracks features shipped in **v2.1.0** and upcoming milestones planned for `img-upload-kit` so the core package stays lean, zero-lock-in, and well-tested. Contributions and RFC feedback are welcome.

---

## Shipped in `v2.1.0` ✅

- **Shared Client Engine (`img-upload-kit/client`)**: Universal XHR upload engine, progress tracker, bounded concurrency queue, pre-upload `transformAsset`, and gallery reorder utilities.
- **First-Class Angular 17–19+ (`img-upload-kit/angular`)**: `provideImageUploadConfig`, `createSingleUpload`, `createMultiUpload` (with `toControlValueAccessor()`), `createImageReveal`, and `mountAnimatedImage`.
- **First-Class React Native & Expo (`img-upload-kit/react-native`)**: `<NativeImageUploadProvider>`, `createExpoImagePickerAdapter`, `createRnImagePickerAdapter` (with automatic iOS HEIC -> JPEG normalization), `useNativeSingleUpload`, `useNativeMultiUpload`, `<SingleImageUpload>`, `<MultiImageUpload>`, and `<AnimatedImage>`.
- **E-Commerce Gallery Reordering & Cover Badge**: `reorderable`, `showCoverBadge`, `move(fromIndex, toIndex)`, `setCover(index)`, and `onReorder` across React, Headless, Angular, and React Native.
- **Social Presets & Smart Attention Cropping**: `square` (`1:1`), `portrait` (`4:5`), and `story` (`9:16`) presets, server-side Sharp `crop: 'attention' | 'entropy' | 'center'`, and `<AnimatedImage aspectRatio="..." />`.

---

## 1. Client-Side Pre-Upload Canvas Resize (`v2.2`)

- **Goal**: Downscale oversized camera photos (e.g. 48 MP mobile captures) in the browser using `createImageBitmap` + `OffscreenCanvas` (or `<canvas>`) before transmitting bytes over the network, while still running server-side Sharp AVIF/WebP optimization and LQIP generation.
- **Proposed API**:
  - Built-in `createClientResizeTransform({ maxWidth, maxHeight, quality })` helper plugging directly into `transformAsset`.
  - Preserves EXIF orientation via modern browser `imageOrientation: 'from-image'`.

---

## 2. Presigned / Direct-to-Storage Uploads (`v2.2`)

- **Goal**: Bypass serverless request body limits (e.g. 4.5 MB on Vercel Functions) by uploading raw or pre-resized files directly to S3/R2/Supabase via presigned PUT/POST URLs, followed by an asynchronous or webhook-triggered processing pass.
- **Proposed API**:
  - `StorageAdapter.createPresignedUpload?(params)` optional method.
  - `createPresignedUploadHandler({ uploader, authorize })` server route helper.
  - Built-in client support in `img-upload-kit/client` for two-step presign + finalize flows.

---

## 3. Content-Hash Deduplication (`v2.2`)

- **Goal**: Avoid storing duplicate objects when the exact same image (`contentHash`) is uploaded multiple times to the same bucket/preset.
- **Proposed API**:
  - `deduplicateByHash?: boolean` on `UploadPresetConfig` and `ImageUploaderOptions`.
  - Optional lookup hook `findExistingByHash?: (hash: string, ctx: { bucket: string; preset?: string }) => Promise<UploadedImageData | null>`.

---

## 4. Animated GIF & Animated WebP Preservation (`v2.3`)

- **Goal**: Preserve multi-frame animations when uploading GIF or animated WebP assets instead of flattening to a single frame.
- **Proposed API**:
  - `animated?: boolean | 'preserve'` on `UploadPresetConfig` and `ImageUploadOptions`.
  - Passes `{ animated: true }` to `sharp(buffer, { animated: true })` and encodes to animated WebP or AVIF sequence when multi-page input is detected (`metadata.pages > 1`).

---

## 5. Additional Storage Adapters (`v2.3`)

- **Goal**: Expand first-party `StorageAdapter` implementations beyond AWS S3 / Cloudflare R2 / MinIO, Supabase Storage, Local Filesystem, and In-Memory:
  - **Vercel Blob** (`createVercelBlobAdapter`)
  - **Google Cloud Storage** (`createGcsStorageAdapter`)
  - **Azure Blob Storage** (`createAzureBlobAdapter`)
  - **Cloudinary** (`createCloudinaryAdapter`)

---

## 6. Interactive Crop, Rotate & Aspect-Ratio Modal (`v2.4`)

- **Goal**: Optional UI modal before upload (especially for `avatar`, `square`, `portrait`, and `cover` presets) allowing users to pan, zoom, rotate 90°, and lock aspect ratios (`1:1`, `4:5`, `9:16`, `16:9`, freeform).
- **Proposed API**:
  - Shipped as an opt-in subpath (`img-upload-kit/crop`) that plugs directly into the `transformAsset` hook introduced in `v2.1.0`.
