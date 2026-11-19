# Roadmap — Shipped & Planned Features

This document tracks milestones shipped across **v2.1**, **v2.2**, and **v2.3** alongside upcoming features planned for `img-upload-kit` so the core package stays lean, zero-lock-in, and well-tested. Contributions and RFC feedback are welcome.

---

## Shipped in v2.3 (Unreleased) ✅

- **Backend-Agnostic 4-Layer CLI (`img-upload-kit/cli`)**: Zero-dependency `ZeroDepCliProgram` powering `init`, `setup`, `doctor` (`--fix`), `validate`, `agents` (`--update`), and `config` alongside static blur manifest commands (`generate`, `validate -f`, `sync`, `cleanup`, `health`, `inspect`), with 4-layer project detection (Frontend, Backend/Sharp runtime, Storage, CDN/Auth), secret redaction, and non-destructive `.env.example` & marker-based `AGENTS.md` merging.
- **Resumable & Multipart Uploads**: Chunked resumable HTTP uploads (`createResumableUploadHandler` + `uploadResumable` with `x-chunk-sha256` verification and retryable session preservation) and S3-compatible multipart uploads (`createMultipartUploadHandler` + `uploadMultipart` with server-generated keys, `100 MB` default cap, and post-complete magic-byte verification).
- **Storage Migration, Signed Downloads & Health Checks**: Resumable cross-provider `migrateStorage` (cursor pagination, dry-run preview, SHA-256 post-copy integrity verification, and guarded source deletion), `createPresignedDownload`, `healthCheck`, `StorageUploadParams.signal`, and `normalizeStorageError` across all built-in adapters.
- **Strict XML Allowlist SVG Sanitizer & Resource Limits**: Zero-dependency XML tokenizer (`svgTokenizer.ts`) and strict tag/attribute/URI/CSS allowlist (`svgAllowlist.ts`, `sanitizeSvg.ts`) with `<svg:svg>` namespace canonicalization and optional `customSanitizer`, paired with `assertImageMetadataLimits` (`maxWidth`, `maxHeight`, `maxPixels`, `maxFrames`).
- **Structured Errors, Rate Limiting, Quotas & Token Hardening**: `UploadKitError` (`toPublicJSON()` redaction, `isRetryableUploadError`), provider-independent `RateLimiter` & `QuotaProvider` contracts (`createMemoryRateLimiter`), proxy-hop-aware `trustProxy` IP extraction, presigned token secret rotation + `sub` ownership verification before `jti` consumption, and `releaseUploadToken` on retryable `finalize` failures.
- **Focal-Point Cropping, `TransformCache` & Ref-Counted Dedupe Coalescing**: Normalized `focalPoint: { x, y }` cropping, `colorSpace: 'srgb' | 'preserve'`, `negotiateOutputFormat`, bounded LRU `createMemoryTransformCache`, and `createInFlightCoalescer` isolating per-caller `AbortSignal`s across concurrent identical uploads.

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
- **First-Class Angular 17–21+ (`img-upload-kit/angular`)**: `provideImageUploadConfig`, `createSingleUpload`, `createMultiUpload` (with `toControlValueAccessor()`), `createImageReveal`, and `mountAnimatedImage`.
- **First-Class React Native & Expo (`img-upload-kit/react-native`)**: `<NativeImageUploadProvider>`, `createExpoImagePickerAdapter`, `createRnImagePickerAdapter` (with automatic iOS HEIC -> JPEG normalization), `useNativeSingleUpload`, `useNativeMultiUpload`, `<SingleImageUpload>`, `<MultiImageUpload>`, and `<AnimatedImage>`.
- **E-Commerce Gallery Reordering & Cover Badge**: `reorderable`, `showCoverBadge`, `move(fromIndex, toIndex)`, `setCover(index)`, and `onReorder` across React, Headless, Angular, and React Native.
- **Social Presets & Smart Attention Cropping**: `square` (`1:1`), `portrait` (`4:5`), and `story` (`9:16`) presets, server-side Sharp `crop: 'attention' | 'entropy' | 'center'`, and `<AnimatedImage aspectRatio="..." />`.

---

## Planned (`v2.4+`)

### 1. Animated GIF & Animated WebP Preservation

- **Goal**: Preserve multi-frame animations when uploading GIF or animated WebP assets instead of flattening to a single frame.
- **Proposed API**: `animated?: boolean | 'preserve'` on `UploadPresetConfig` and `ImageUploadOptions`, passing `{ animated: true }` to `sharp(buffer, { animated: true })` and encoding to animated WebP or AVIF sequence when `metadata.pages > 1` (bounded by `maxFrames`).

### 2. First-Party Vercel Blob, GCS, Azure & Cloudinary Storage Adapters

- **Goal**: Ship first-party zero-lock-in structural adapters (`createVercelBlobAdapter`, `createGcsStorageAdapter`, `createAzureBlobAdapter`, `createCloudinaryAdapter`) alongside the existing LocalFS, S3/R2/MinIO/Spaces/B2, Supabase, Memory, and custom `StorageAdapter` contract.

### 3. Interactive Crop, Rotate & Aspect-Ratio Modal

- **Goal**: Opt-in pre-upload UI modal (`img-upload-kit/crop`) allowing users to pan, zoom, rotate 90°, and lock aspect ratios (`1:1`, `4:5`, `9:16`, `16:9`, freeform), plugging directly into `transformAsset` and chaining cleanly with `createClientResizeTransform` via `composeTransforms`.
