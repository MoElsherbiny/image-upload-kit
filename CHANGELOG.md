# Changelog

All notable changes to `img-upload-kit` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-31

### Added

- **AnimatedImage Component (`img-upload-kit/react`)**:
  - High-performance progressive blur-up display component with GPU-accelerated crossfade.
  - Native `<img>` attribute pass-through and framework-agnostic `as` prop (e.g. `as={Image}` for Next.js with `imageComponentProps`).
  - Hierarchical placeholder fallback cascade: `blurDataUrl` (LQIP) > `blurHash` (client canvas decode) > `blurColor` (gradient SVG).
  - Shimmer highlight animation (`showShimmer`), staggered transition timing, and full `prefers-reduced-motion` compliance.
  - Semantic slot targeting (`data-slot`, `data-state`, `aria-busy`) and unstyled mode support.
- **Headless Reveal State Machine (`useImageReveal`)**:
  - Headless hook managing progressive reveal states (`isLoaded`, `showPlaceholder`, `hasError`, `imgRef`, `handleLoad`, `handleError`).
  - Guarantees pre-decode verification via `HTMLImageElement.decode()` before revealing sharp asset.
  - Synchronous reset on `srcKey` changes and automatic detection of pre-cached images.
- **Placeholder Utilities**:
  - `createFallbackBlurSvg`: Generates lightweight inline SVG gradients derived from dominant color.
  - `resolveMeaningfulColor`: Filters out generic neutral/black/white database defaults and validates color tokens.
  - `resolvePlaceholderUrl`: Deterministically selects the best available placeholder asset.

### Changed & Hardened

- **Server Validation Error Mapping**:
  - Updated `createUploadHttpHandler.POST` to map client validation errors (file size limits, unsupported MIME types, missing file payloads) directly to HTTP 400 Bad Request instead of internal server errors.
- **Collision Retry Discrimination**:
  - Fixed collision detection in `uploadRetry.ts` to strictly match `already exists` and `EEXIST` error codes without falsely triggering on `does not exist` messages.
- **Sharp Mobile EXIF Auto-Rotation**:
  - Added `.rotate()` during Sharp pipeline initialization in `imageOptimizer.ts` to automatically orient smartphone and digital camera uploads according to EXIF orientation metadata.
- **Transparent PNG Color Extraction**:
  - Hardened `colorHistogram.ts` to ignore pixels with `alpha < 8`, preventing transparent PNG graphics from skewing dominant edge colors toward black or white.
- **BlurHash & SVG Detection**:
  - Enhanced SVG validation in `blurGenerator.ts` to perform case-insensitive checks across the initial 1024 bytes and clamped BlurHash components to valid ranges (1–9).
- **Storage Parity & Upsert Semantics**:
  - Implemented `deleteByUrl` in `createLocalFsStorageAdapter` for parity with cloud storage providers.
  - Aligned default `upsert` semantics to `true` across all adapters for consistent overwrite behavior.
- **React Pure State Updaters & Controlled Value Sync**:
  - Refactored `useMultiImageState.ts` and `useSingleImageState.ts` to maintain synchronous `previewsRef` snapshots.
  - Removed side-effect dispatches (`emitImmediateChange`) from inside `setPreviews` functional updaters for strict React 18/19 concurrent rendering purity.
  - Properly reset uploaded data and blur previews when single uploader `value` transitions to `null`.
- **Batch Preemption Clearing in Multi-Upload**:
  - Fixed retention window in `MultiImageUpload.tsx`: active batch references are now explicitly cleared when an in-flight retention timer is preempted by a new upload batch.

## [1.0.0] - 2026-10-31

### Added

- **Core Types & Utilities (`img-upload-kit`)**:
  - Universal project-agnostic visual role presets (`thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`).
  - `defineUploadPresets` helper and `UploadKitRegister` TypeScript module augmentation for global preset autocomplete.
  - Bilingual (`en` / `ar`) file validation, quality level presets, byte formatters, and RGB/HEX color utilities.
- **Server Optimization & Upload Pipeline (`img-upload-kit/server`)**:
  - `createImageUploader` with preset inheritance, path sanitization, SHA-256 content hashing, retry handling, and `AsyncSemaphore` concurrency control.
  - `createUploadHttpHandler` returning Web Standard `POST` and `DELETE` Fetch handlers (`Request` -> `Response`) compatible with Next.js App Router, Remix, React Router, Hono, SvelteKit, and Node servers.
  - `optimizeImage` powered by Sharp with smart AVIF size-guarding (preventing file bloat on pre-compressed JPEGs), WebP fallback, and SVG passthrough.
  - `generateBlurPlaceholder` generating compact WebP LQIP data URLs, optional BlurHash strings, and 4-edge weighted dominant color histograms.
- **Pluggable Storage Adapters (`img-upload-kit/storage`)**:
  - `StorageAdapter` contract and `createStorageAdapter` authoring helper.
  - Built-in `createSupabaseStorageAdapter`, `createS3StorageAdapter` (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces), `createLocalFsStorageAdapter` (with path-traversal protection), and `createMemoryStorageAdapter`.
  - `onUploadRecord` hook for persisting upload metadata to Prisma, Drizzle, or analytics pipelines.
- **Blur Manifest Service (`img-upload-kit/blur`)**:
  - `BlurService` and `createBlurService` with bounded `LRUCache`, normalized URL/path lookup, and SVG fallback placeholders.
- **Pure React UI & Styles (`img-upload-kit/react`, `img-upload-kit/styles.css`)**:
  - Framework-agnostic `<ImageUploadProvider>`, `<ImageUpload>`, `<SingleImageUpload>`, `<MultiImageUpload>`, `<BlurImage>`, and `<QualitySelector>`.
  - First-class English & Arabic (`dir="rtl"`) localization, custom `renderImage` adapter slot, and themeable `--iuk-*` CSS custom properties.
- **Headless Hooks & Primitives (`img-upload-kit/headless`)**:
  - Unstyled controllers: `HeadlessSingleUpload`, `HeadlessMultiUpload`, `useSingleUpload`, `useMultiUpload`, `useImageUpload`, `useDropzone`, `useFilePreview`.
- **Blur Manifest CLI (`img-upload-kit/cli`)**:
  - `img-upload-kit` / `blur-cli` binaries (`generate`, `validate`, `sync`, `cleanup`, `health`, `inspect`) for build-time `blur-hashes.json` generation.
