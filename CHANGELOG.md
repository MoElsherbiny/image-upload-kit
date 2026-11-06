# Changelog

All notable changes to `img-upload-kit` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-11-06

See [`MIGRATION.md`](./MIGRATION.md) for step-by-step v1.x to v2.0.0 upgrade instructions and before/after examples.

### Breaking Changes

- **Dependencies**: Moved `sharp` and `lqip-modern` to optional `peerDependencies` (loaded lazily in `img-upload-kit/server` and `img-upload-kit/cli` with actionable install errors). Removed `lucide-react` in favor of zero-dependency inlined SVG icons (`src/react/icons.tsx`).
- **SVG Disabled by Default**: Removed `image/svg+xml` from `DEFAULT_ALLOWED_FORMATS` and all `STANDARD_PRESETS`. Enable via `allowSvg: true` on `createImageUploader`, a preset, or per-upload options.
- **Secure-by-Default HTTP Handler**: `createUploadHttpHandler` now ignores client `FormData` overrides (`customFilename`, `folder`, `maxWidth`, `maxHeight`, `outputFormat`, `quality`) unless explicitly opted in via `allowClientOverrides`.
- **Context-Aware `authorize(ctx)`**: `UploadHttpHandlerOptions.authorize` now receives `AuthorizeContext` (`{ action, request, path?, bucket?, preset? }`).
- **`<AnimatedImage>` Reveal Parity & Error State**: Default `animationDuration` changed from `700` ms to `600` ms with `scale(1.02 -> 1)` settle reveal (`revealScale`, default `1.02`), `inset: 0; scale(1.1); blur(20px)` placeholder geometry, immediate `5/6` placeholder fade, and `colorPlaceholder="flat"` default for color-only placeholders. On load error, the placeholder remains visible while the broken image is hidden (`data-state="error"`).
- **Storage, Blur & CLI Contracts**: Removed phantom `-blur.avif` / `-thumb.avif` deletes in Supabase `deleteByUrl`; made `?t=` preview cache-busting opt-in (`appendCacheBuster`); excluded 40px LQIP data URLs from `createSrcSetWithBlur`; preserved `/<bucket>/<path>` in `normalizeImagePath` for Supabase URLs; made `mirrorBufferLocally` async (`Promise<string>`); moved CLI auto-execution to `dist/bin.js`.
- **Package `exports`**: Updated `package.json` `exports` to nested `import` / `require` conditions with `.d.ts` and `.d.cts` types.

### Security

- **Binary Magic-Byte Sniffing (`sniffImageFormat`)**: Verified binary signatures (JPEG, PNG, GIF, WebP, AVIF/HEIF `ftyp`, TIFF, SVG) against `allowedFormats` before Sharp decoding, blocking spoofed MIME types.
- **Built-in SVG Sanitizer (`sanitizeSvg`)**: Dependency-free allowlist sanitizer when `allowSvg: true` that strips `<script>`, `<foreignObject>`, `<iframe|embed|object>`, `on*` handlers, unsafe `href`/`xlink:href` targets, and `<!ENTITY`/`DOCTYPE` declarations.
- **HTTP Handler Guards**: Added streaming `maxBodyBytes` enforcement (HTTP `413`), `allowedOrigins` CSRF validation (HTTP `403`), `DELETE` bucket allowlist enforcement (HTTP `403`), client filename extension enforcement + non-upsert collision suffixing, generic HTTP `500` error bodies with `onError(error, ctx)`, and `limitInputPixels` (default 50 MP) decompression-bomb protection.
- **Local Filesystem Containment**: Hardened `createLocalFsStorageAdapter` with `path.relative` traversal checks, Windows drive/colon rejection, and atomic `flag: 'wx'` writes when `upsert: false`.

### Added

- **Responsive Image Variants (`variantWidths`)**: Generate multi-width responsive variants (`<base>-<w>w.<ext>`) in parallel, returning `variants: ImageVariant[]` and `srcSet` on `UploadedImageData` and cleaning up all variants in `deleteImage`. `<AnimatedImage image={data} />` automatically wires `srcSet` and default `sizes="100vw"` when `fill` is set.
- **Clipboard Paste & Mobile Camera Capture**: Added `enablePaste` (default `true`), `pasteTarget: 'dropzone' | 'document'`, and `capture?: 'user' | 'environment'` across `<SingleImageUpload>`, `<MultiImageUpload>`, and headless controllers (`useClipboardPaste`).
- **Per-Tile Cancel & Retry**: Added per-upload `AbortController` cancellation (`cancel(id)` / tile Cancel button) and per-tile or batch retry (`retry(id)` / `retryAll()`), plus `onUploadStart`, `onUploadComplete`, and `onUploadCancel` callbacks.
- **Form Integration (`name`, `formValue`, `ref`, `required`, `minImages`)**: Synchronized `<input type="hidden" name={name} />` (`formValue: 'url' | 'json'`), `forwardRef<ImageUploadHandle>` (`{ focus, open, clear }`), `onBlur`, and native constraint validation for `required` and `minImages`.
- **`<AnimatedImage>` Props**: Added first-class `priority` and `quality` props (preventing Next.js `loading="lazy"` conflicts), `revealScale`, `colorPlaceholder: 'flat' | 'gradient'`, `neutralColors`, `fallbackSrc` (single automatic retry), `renderError`, and `var(--token)` support in `resolveBackgroundColor`.
- **Edge-Safe Handler & Modular CSS Exports**: Added `img-upload-kit/server/handler` (zero Sharp/`node:fs` imports), `img-upload-kit/styles/*.css` layer exports, and `scripts/check-dist.mjs` build verification.

### Fixed

- **RSC `'use client'` & Shared Singletons**: Preserved `'use client'` directives at the top of all client chunks and deduplicated `ImageUploadContext` and `blurService` across `img-upload-kit/react`, `img-upload-kit/headless`, and `img-upload-kit/blur`.
- **Server & Storage Correctness**: Fixed passthrough EXIF `.rotate()` and dimension swapping (EXIF 5–8), preserved GIF/TIFF/HEIF format labels, held `AsyncSemaphore` slots until timed-out Sharp jobs settle, rolled back uploaded storage objects when `onUploadRecord` throws, added S3 `IfNoneMatch: '*'` for `upsert: false`, and paginated S3/Supabase `list()`.
- **React State, Memory & Accessibility**: Fixed parallel upload progress races (`uploadTracker`), stale alt text on replacement, `URL.createObjectURL` preview cleanup, modal focus trapping/restoration (`useDialog`), WAI-ARIA radio keyboard navigation in `<QualitySelector>`, `role="progressbar"` attributes, and `aria-live="polite"` upload announcements.

### Performance

- **Single-Decode Blur Pipeline**: `generateBlurPlaceholder` now decodes the source image once into a 128 px buffer and derives the WebP LQIP data URL, 4-edge dominant color histogram, and BlurHash from the shared buffer (reducing Sharp decodes from 3–4 to 1).
- **Web Crypto & Object URLs**: Replaced `FileReader.readAsDataURL` client previews with zero-copy `URL.createObjectURL` and migrated server hashing to `globalThis.crypto`.

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

- **Server Validation Error Mapping**: Updated `createUploadHttpHandler.POST` to map client validation errors directly to HTTP 400 Bad Request.
- **Collision Retry Discrimination**: Fixed collision detection in `uploadRetry.ts` to strictly match `already exists` and `EEXIST` error codes.
- **Sharp Mobile EXIF Auto-Rotation**: Added `.rotate()` during Sharp pipeline initialization in `imageOptimizer.ts`.
- **Transparent PNG Color Extraction**: Hardened `colorHistogram.ts` to ignore pixels with `alpha < 8`.
- **BlurHash & SVG Detection**: Enhanced SVG validation in `blurGenerator.ts` and clamped BlurHash components to valid ranges (1–9).
- **Storage Parity & Upsert Semantics**: Implemented `deleteByUrl` in `createLocalFsStorageAdapter` and aligned default `upsert` semantics to `true`.
- **React Pure State Updaters & Controlled Value Sync**: Refactored `useMultiImageState.ts` and `useSingleImageState.ts` for strict React 18/19 concurrent rendering purity.
- **Batch Preemption Clearing in Multi-Upload**: Fixed retention window in `MultiImageUpload.tsx` when preempted by a new upload batch.

## [1.0.0] - 2026-10-31

### Added

- **Core Types & Utilities (`img-upload-kit`)**: Universal visual role presets (`thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`), `defineUploadPresets`, `UploadKitRegister`, bilingual (`en` / `ar`) validation, byte formatters, and RGB/HEX color utilities.
- **Server Optimization & Upload Pipeline (`img-upload-kit/server`)**: `createImageUploader`, `createUploadHttpHandler`, `optimizeImage` with Sharp AVIF size-guarding, and `generateBlurPlaceholder` (WebP LQIP, BlurHash, 4-edge color histogram).
- **Pluggable Storage Adapters (`img-upload-kit/storage`)**: `createSupabaseStorageAdapter`, `createS3StorageAdapter`, `createLocalFsStorageAdapter`, `createMemoryStorageAdapter`, and `onUploadRecord`.
- **Blur Manifest Service (`img-upload-kit/blur`)**: `BlurService` and `createBlurService` with bounded `LRUCache`.
- **Pure React UI & Styles (`img-upload-kit/react`, `img-upload-kit/styles.css`)**: `<ImageUploadProvider>`, `<ImageUpload>`, `<SingleImageUpload>`, `<MultiImageUpload>`, `<BlurImage>`, and `<QualitySelector>` with RTL & `--iuk-*` tokens.
- **Headless Hooks & Primitives (`img-upload-kit/headless`)**: `HeadlessSingleUpload`, `HeadlessMultiUpload`, `useSingleUpload`, `useMultiUpload`, `useImageUpload`, `useDropzone`, `useFilePreview`.
- **Blur Manifest CLI (`img-upload-kit/cli`)**: `img-upload-kit` / `blur-cli` binaries (`generate`, `validate`, `sync`, `cleanup`, `health`, `inspect`).
