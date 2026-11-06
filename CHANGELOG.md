# Changelog

All notable changes to `img-upload-kit` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-11-06

### Added

- **Shared Framework-Agnostic Client Engine (`img-upload-kit/client`)**:
  - Extracted universal client upload primitives (`xhrUpload`, `createUploadAbortError`, `isUploadAbortError`, `createUploadTracker`, `runUploadQueue`, `moveItem`, `promoteToCover`, `runTransformAsset`, `normalizeUploadableAsset`, `isNativeUploadAsset`) shared across React, Angular, and React Native.
- **First-Class Angular 17–19+ Subpath (`img-upload-kit/angular`)**:
  - Added `provideImageUploadConfig`, `IMAGE_UPLOAD_CONFIG`, and `resolveImageUploadConfig` for dependency-injected configuration.
  - Added reactive upload controllers `createSingleUpload` and `createMultiUpload` with signal-like `.state()` getters, `.subscribe(listener)`, per-tile cancel/retry, gallery reordering (`move`, `setCover`, `setPrimary`), and `.toControlValueAccessor()` for `@angular/forms` Reactive Forms.
  - Added `createImageReveal`, `mountAnimatedImage`, and standalone helper classes (`AnimatedImageComponent`, `SingleImageUploadComponent`, `MultiImageUploadComponent`).
- **First-Class React Native & Expo Subpath (`img-upload-kit/react-native`)**:
  - Added `<NativeImageUploadProvider>`, `useNativeImageUploadConfig`, `useNativeSingleUpload`, `useNativeMultiUpload`, `<SingleImageUpload>`, `<MultiImageUpload>`, and `<AnimatedImage>`.
  - Added `createExpoImagePickerAdapter` (`expo-image-picker`) and `createRnImagePickerAdapter` (`react-native-image-picker`) with automatic iOS `.heic`/`.heif` -> `.jpg` (`image/jpeg`) filename/MIME normalization.
  - Added `defaultNativeTheme`, `lightNativeTheme`, and `darkNativeTheme` for React Native `StyleSheet` theming, plus `as={Image}` support for `expo-image` and `objectFit="contain"` ambient blur backdrops.
- **Social & E-Commerce Presets + Smart Server Attention Cropping**:
  - Added `square` (`1600x1600`, `1:1`, `crop: 'attention'`, `variantWidths: [400, 800, 1200]`), `portrait` (`1080x1350`, `4:5`, `crop: 'attention'`, `variantWidths: [480, 720]`), and `story` (`1080x1920`, `9:16`, `crop: 'attention'`, `variantWidths: [540, 720]`) to `STANDARD_PRESETS`.
  - Added `ImageAspectRatio` (`'1:1' | '4:5' | '3:4' | '4:3' | '3:2' | '16:10' | '16:9' | '9:16' | 'auto' | number`), `CropStrategy` (`'attention' | 'entropy' | 'center'`), `resolveAspectRatio`, and `aspectRatioToCss`.
  - Enhanced `optimizeImage`, `createImageUploader`, and `createUploadHttpHandler` (`allowClientOverrides.aspectRatio` & `crop`) with Sharp `fit: 'cover'` smart cropping.
- **E-Commerce Gallery Reordering & Primary Cover Badge**:
  - Added `reorderable`, `showCoverBadge`, `onReorder`, `move(fromIndex, toIndex)`, `setCover(index)`, and `setPrimary(index)` across `<MultiImageUpload>`, `<HeadlessMultiUpload>`, `useMultiUpload`, `createMultiUpload`, and `useNativeMultiUpload`.
  - Added bilingual (`en` / `ar`) translations for `"Cover"`, `"Set as cover"`, `"Move earlier"`, and `"Move later"`.
- **Pre-Upload Client `transformAsset` Hook & `<AnimatedImage aspectRatio>`**:
  - Added `transformAsset` (`(asset, { signal, preset, index }) => Promise<asset>`) with `AbortSignal` propagation before network upload.
  - Added `aspectRatio?: ImageAspectRatio` prop to `<AnimatedImage>` across React, Angular, and React Native.

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

- **AnimatedImage Component (`img-upload-kit/react`)**: Progressive blur-up display component with GPU-accelerated crossfade, `as` prop for `next/image`, `blurDataUrl` > `blurHash` > `blurColor` fallback cascade, `showShimmer`, and `useImageReveal` headless state machine.

## [1.0.0] - 2026-10-31

### Added

- Initial release of `img-upload-kit` with core types, Sharp AVIF/WebP optimization, 4-edge color extraction, `StorageAdapter` (Supabase, S3/R2, LocalFS, Memory), `BlurService`, React UI & Headless primitives, and CLI manifest generator.
