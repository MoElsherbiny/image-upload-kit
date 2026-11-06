# Roadmap — Post-v2.2 Planned Features

This document tracks features shipped in **v2.1.0** and **v2.2.0** alongside upcoming milestones planned for `img-upload-kit` so the core package stays lean, zero-lock-in, and well-tested. Contributions and RFC feedback are welcome.

---

## Shipped in `v2.2.0` ✅

- **First-Class Vue 3.5+ & Nuxt 4 (`img-upload-kit/vue`)**: `createImageUpload` plugin, `provideImageUpload`, `useSingleUpload`, `useMultiUpload`, `useImageReveal`, `<SingleImageUpload v-model>`, `<MultiImageUpload v-model reorderable>`, `<AnimatedImage>`, and scoped-slot `<HeadlessSingleUpload>` / `<HeadlessMultiUpload>`.
- **Client-Side Pre-Upload Resize (`img-upload-kit/client` & `img-upload-kit/react-native`)**: Browser `createClientResizeTransform({ maxWidth, maxHeight, quality, skipBelowBytes })` using `createImageBitmap` (`imageOrientation: 'from-image'`) + `OffscreenCanvas`, `composeTransforms`, and React Native `createExpoManipulatorResizeTransform`.
- **Presigned Direct-to-Storage Uploads (`uploadMode: 'presigned'`)**: Two-phase presign (`?action=presign`) + direct storage `PUT`/`POST` + server finalize (`?action=finalize`) with HMAC-SHA256 signed staging tokens, `StorageAdapter.createPresignedUpload` & `download`, and `uploadViaPresignedUrl`.
- **Content-Hash Deduplication (`deduplicate` & `createMemoryDedupeStore`)**: Composite SHA-256 deduplication key scoped across raw file bytes, bucket, preset, dimensions, aspect ratio, format, and variants, with `data.deduplicated` reporting and optional `storage.exists` verification.
- **Pointer-Drag Gallery Reordering & Zoneless Angular Signals**: `attachPointerReorder` across React, Vue, and Angular grids (`[data-dragging]` / `[data-drop-target]`), plus `withAngularSignals` for Zoneless Angular 18–21+ `OnPush` components and zero runtime `"dependencies"` in `package.json`.

---

## Shipped in `v2.1.0` ✅

- **Shared Client Engine (`img-upload-kit/client`)**: Universal XHR upload engine, progress tracker, bounded concurrency queue, pre-upload `transformAsset`, and gallery reorder utilities.
- **First-Class Angular 17–19+ (`img-upload-kit/angular`)**: `provideImageUploadConfig`, `createSingleUpload`, `createMultiUpload` (with `toControlValueAccessor()`), `createImageReveal`, and `mountAnimatedImage`.
- **First-Class React Native & Expo (`img-upload-kit/react-native`)**: `<NativeImageUploadProvider>`, `createExpoImagePickerAdapter`, `createRnImagePickerAdapter` (with automatic iOS HEIC -> JPEG normalization), `useNativeSingleUpload`, `useNativeMultiUpload`, `<SingleImageUpload>`, `<MultiImageUpload>`, and `<AnimatedImage>`.
- **E-Commerce Gallery Reordering & Cover Badge**: `reorderable`, `showCoverBadge`, `move(fromIndex, toIndex)`, `setCover(index)`, and `onReorder` across React, Headless, Angular, and React Native.
- **Social Presets & Smart Attention Cropping**: `square` (`1:1`), `portrait` (`4:5`), and `story` (`9:16`) presets, server-side Sharp `crop: 'attention' | 'entropy' | 'center'`, and `<AnimatedImage aspectRatio="..." />`.

---

## 1. Animated GIF & Animated WebP Preservation (`v2.3`)

- **Goal**: Preserve multi-frame animations when uploading GIF or animated WebP assets instead of flattening to a single frame.
- **Proposed API**:
  - `animated?: boolean | 'preserve'` on `UploadPresetConfig` and `ImageUploadOptions`.
  - Passes `{ animated: true }` to `sharp(buffer, { animated: true })` and encodes to animated WebP or AVIF sequence when multi-page input is detected (`metadata.pages > 1`).

---

## 2. Additional Storage Adapters (`v2.3`)

- **Goal**: Expand first-party `StorageAdapter` implementations beyond AWS S3 / Cloudflare R2 / MinIO, Supabase Storage, Local Filesystem, and In-Memory:
  - **Vercel Blob** (`createVercelBlobAdapter`)
  - **Google Cloud Storage** (`createGcsStorageAdapter`)
  - **Azure Blob Storage** (`createAzureBlobAdapter`)
  - **Cloudinary** (`createCloudinaryAdapter`)

---

## 3. Interactive Crop, Rotate & Aspect-Ratio Modal (`v2.4`)

- **Goal**: Optional UI modal before upload (especially for `avatar`, `square`, `portrait`, and `cover` presets) allowing users to pan, zoom, rotate 90°, and lock aspect ratios (`1:1`, `4:5`, `9:16`, `16:9`, freeform).
- **Proposed API**:
  - Shipped as an opt-in subpath (`img-upload-kit/crop`) that plugs directly into the `transformAsset` hook (and chains cleanly with `createClientResizeTransform` via `composeTransforms`).
