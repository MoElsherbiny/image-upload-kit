# Changelog

All notable changes to `img-upload-kit` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-11-06

### Added

- **First-Class Vue 3.5+ & Nuxt 4 Subpath (`img-upload-kit/vue`)**:
  - Added `createImageUpload` Vue plugin, `provideImageUpload`, `useImageUploadConfig`, and `IMAGE_UPLOAD_INJECTION_KEY`.
  - Added reactive composables `useSingleUpload`, `useMultiUpload`, and `useImageReveal`.
  - Added drop-in components `<SingleImageUpload>`, `<MultiImageUpload>` (with `v-model`, pointer-drag + keyboard reordering, and `Cover` badge), `<AnimatedImage>`, and scoped-slot headless components `<HeadlessSingleUpload>` and `<HeadlessMultiUpload>`.
- **Client-Side Pre-Upload Resize (`createClientResizeTransform` & `composeTransforms`)**:
  - Added SSR-safe browser downscaling transform using `createImageBitmap` (`imageOrientation: 'from-image'`) + `OffscreenCanvas` in `img-upload-kit/client`, plus `composeTransforms` with `AbortSignal` propagation.
  - Added `createExpoManipulatorResizeTransform` in `img-upload-kit/react-native` for pre-upload mobile image resizing via `expo-image-manipulator`.
- **Presigned Direct-to-Storage Uploads (`uploadMode: 'presigned'`)**:
  - Added two-phase presigned upload support (`POST ?action=presign` -> direct S3/R2/storage `PUT`/`POST` -> `POST ?action=finalize` with HMAC-SHA256 signed staging tokens, magic-byte validation, Sharp AVIF/WebP optimization, LQIP, and responsive variants).
  - Added optional `createPresignedUpload` and `download` methods to `StorageAdapter` (implemented in S3/R2, LocalFS, and Memory adapters) and `uploadAsset` / `uploadViaPresignedUrl` in `img-upload-kit/client`.
- **Content-Hash Deduplication (`deduplicate` & `createMemoryDedupeStore`)**:
  - Added `deduplicate` option to `createImageUploader`, `ImageDedupeStore` interface, `createMemoryDedupeStore` LRU cache, composite SHA-256 deduplication key (`computeDedupeCompositeKey` scoped across raw hash, bucket, preset, dimensions, aspect ratio, format, and variants), and `data.deduplicated?: boolean` on `UploadedImageData`.
- **Pointer-Drag Gallery Reordering (`attachPointerReorder`)**:
  - Added framework-agnostic pointer-events drag-and-drop gallery reorder enhancer (`src/core/pointerReorder.ts`) wired into React `<MultiImageUpload>`, Vue `<MultiImageUpload>`, and Angular `mountMultiImageUpload` alongside accessible Move/Cover buttons and `Alt+ArrowLeft/Right` keyboard shortcuts.
- **Zoneless Angular Signals Bridge (`withAngularSignals`)**:
  - Added `withAngularSignals(controller, { signal, destroyRef })` in `img-upload-kit/angular` to bridge `AngularSignal<T>` properties into native `@angular/core` `Signal<T>` instances for Zoneless Angular 18–21+ `OnPush` components.
- **Opt-In Client Deletion (`deleteUploadedImage`, `deleteEndpoint`, `customDeleter`)**:
  - Added `deleteUploadedImage` in `img-upload-kit/client` and opt-in `deleteEndpoint` / `customDeleter` support across React, Vue, Angular, and React Native single and multi-upload controllers.

### Changed & Fixed

- **Zero Runtime Dependencies (Supply-Chain Hardening)**:
  - Removed all runtime `"dependencies"` (`blurhash` is now bundled into `dist/`, and `sharp` / `lqip-modern` remain optional `peerDependencies`), ensuring `npm install img-upload-kit` installs zero third-party runtime packages by default.
- **Audit Fixes Across Platforms**:
  - Unified bilingual (`en` / `ar`) translations under `src/i18n` and shared placeholder utilities under `src/core/placeholder.ts`.
  - Added `resolveImageUploadConfig`, `phase()`, `canSave()`, `selectFiles()`, and top-level `.subscribe()` to Angular controllers; added localized labels and keyboard/pointer reordering to `mountSingleImageUpload` / `mountMultiImageUpload`.
  - Fixed React Native `AnimatedImage` `priority` prop forwarding to custom `as={Image}` components (`expo-image`) and ensured `revealScale <= 1` skips unnecessary bounce animations.

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
  - Added `ImageAspectRatio`, `CropStrategy`, `resolveAspectRatio`, and `aspectRatioToCss`.
- **E-Commerce Gallery Reordering & Primary Cover Badge**:
  - Added `reorderable`, `showCoverBadge`, `onReorder`, `move(fromIndex, toIndex)`, `setCover(index)`, and `setPrimary(index)` across `<MultiImageUpload>`, `<HeadlessMultiUpload>`, `useMultiUpload`, `createMultiUpload`, and `useNativeMultiUpload`.
- **Pre-Upload Client `transformAsset` Hook & `<AnimatedImage aspectRatio>`**:
  - Added `transformAsset` (`(asset, { signal, preset, index }) => Promise<asset>`) with `AbortSignal` propagation before network upload, and `aspectRatio?: ImageAspectRatio` on `<AnimatedImage>`.

## [2.0.0] - 2026-11-06

See [`MIGRATION.md`](./MIGRATION.md) for step-by-step v1.x to v2.0.0 upgrade instructions and before/after examples.

### Breaking Changes

- **Dependencies**: Moved `sharp` and `lqip-modern` to optional `peerDependencies`. Removed `lucide-react` in favor of zero-dependency inlined SVG icons (`src/react/icons.tsx`).
- **SVG Disabled by Default**: Removed `image/svg+xml` from `DEFAULT_ALLOWED_FORMATS` and all `STANDARD_PRESETS`. Enable via `allowSvg: true`.
- **Secure-by-Default HTTP Handler**: `createUploadHttpHandler` ignores client `FormData` overrides unless explicitly opted in via `allowClientOverrides`.
- **Context-Aware `authorize(ctx)`**: `UploadHttpHandlerOptions.authorize` receives `AuthorizeContext` (`{ action, request, path?, bucket?, preset? }`).
- **`<AnimatedImage>` Reveal Parity & Error State**: Default `animationDuration` changed from `700` ms to `600` ms with `scale(1.02 -> 1)` settle reveal (`revealScale`, default `1.02`).

### Security, Added, Fixed & Performance

- **Security**: Binary magic-byte sniffing (`sniffImageFormat`), allowlist SVG sanitizer (`sanitizeSvg`), streaming `maxBodyBytes` (HTTP `413`), `allowedOrigins` CSRF checks (HTTP `403`), `DELETE` bucket allowlists, and local filesystem path traversal containment.
- **Features**: Responsive image variants (`variantWidths`), clipboard paste & camera capture, per-tile cancel/retry, native HTML / React Hook Form integration, edge-safe `img-upload-kit/server/handler`, and single-decode blur pipeline.

## [1.1.0] - 2026-10-31

- Added `<AnimatedImage>` progressive blur-up display component (`img-upload-kit/react`) and `useImageReveal`.

## [1.0.0] - 2026-10-31

- Initial release of `img-upload-kit`.
