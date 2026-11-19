# Changelog

All notable changes to `img-upload-kit` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - 2026-11-19

### Security

- Hardened `createMultipartUploadHandler` defaults (`H-1`, `H-2`, `L-7`): server-generated object keys by default (`allowClientPathOverride: false`), image-only default allowed MIME types (dropped `application/octet-stream`), `100 MB` default `maxTotalBytes` with accurate byte accounting when parts are re-uploaded, and post-completion magic-byte verification (`validateOnComplete: true`).
- Fixed `createResumableUploadHandler` (`H-3`) so sessions persist and upload to the exact bucket resolved and authorized during `init` (honoring preset buckets instead of falling back to `defaultBucket`).
- Hardened rate-limit client IP extraction (`M-1`): `X-Forwarded-For` is ignored by default unless `trustProxy?: boolean | number` is explicitly configured (extracting the entry `N` hops from the right).
- Documented per-user delete ownership & folder scoping (`M-4`) and dedicated private `presigned.stagingBucket` + 1-day `_staging/` lifecycle cleanup (`M-5`) in `docs/SECURITY_GUIDE.md`, `docs/presigned-and-dedupe.md`, and `README.md`.
- Hardened `createMemoryStorageAdapter` (`L-4`) with `sanitizeStorageKey` and `validateStorageMetadata` parity across all built-in storage adapters.
- Hardened generated Next.js, Nuxt, and Node server scaffolds to use fail-closed `authorize` checks (`authorization` / `cookie` header presence) instead of unconditional `() => true`.
- Hardened upload token verification, secret rotation, `sub` ownership enforcement before `jti` replay consumption, SVG allowlist sanitization (preserving `xmlns` on namespace-prefixed `<svg:svg>` roots, `L-5`), and binary magic-byte/metadata limits.

### Added & Changed

- **Backend-Agnostic 4-Layer CLI Engine**:
  - Wired `detectProject` + `resolveArchitecture` + `planDependencies` directly into `runInteractiveInit` so frontend-only Vite projects and Edge runtimes (Cloudflare Workers / Vercel Edge) never receive `sharp` in their install plan, and detected cloud/custom-adapter providers (GCS, Azure Blob, Firebase, S3/R2, Supabase) are reported accurately in `RunInitResult.storage` and Quick Start snippets (`L-6`).
  - Added `doctor`, `validate`, `agents`, and `config` CLI commands (`ZeroDepCliProgram`) with secret redaction, non-destructive `.env.example` / `AGENTS.md` merging, transactional file writes, and user-facing CLI guide (`docs/CLI.md`).
  - Added reproducible Corepack + `pnpm install --frozen-lockfile` (`packageManager: "pnpm@9.15.0"`) across Ubuntu Node 20/22/24 and `windows-latest` CI/Release workflows, canonical 7-tier `tests/` pyramid (`unit`, `frameworks`, `cli`, `security`, `integration`, `e2e`, `packaging`), and resolved dev-dependency `pnpm audit` advisories (`M-8`).
- **Storage, Optimization & Reliability**:
  - Expanded storage adapter contracts with health checks, presigned downloads, multipart hooks, `signal` propagation, key/metadata validation, resumable `migrateStorage`, and normalized error handling (`UploadKitError`) across `upload`, `delete`, `download`, and `deleteByUrl` (`M-3`).
  - Isolated per-caller `AbortSignal` waiting in ref-counted in-flight deduplication coalescing (`inFlightCoalescer.ts`, `M-2`), preserved resumable sessions and staged presigned tokens/objects (`releaseUploadToken`) on retryable storage failures (`M-6`), propagated `AbortSignal` through storage/variant/hook steps (`L-1`), routed cleanup errors to `onError` (`L-2`), and removed unsafe handler option casts (`L-3`).
  - Improved Sharp optimization concurrency (`AsyncSemaphore`), `focalPoint` cropping, `colorSpace` normalization, format negotiation (`negotiateOutputFormat`), transform caching (`createMemoryTransformCache`), and production documentation (`docs/CLI.md`, `docs/SECURITY_GUIDE.md`, `docs/STORAGE_ADAPTERS.md`, `docs/ERROR_HANDLING.md`, `docs/BENCHMARKS.md`), backed by automated isolated TypeScript verification of every documentation `ts`/`tsx` code block (`M-7`).

### Fixed

- Fixed all generated CLI storage and framework scaffolds to match real `img-upload-kit` TypeScript signatures:
  - S3/R2/MinIO/Spaces/B2/custom-S3 templates now construct `S3Client` and forward `PutObjectCommand`, `DeleteObjectCommand`, `GetObjectCommand`, and `HeadObjectCommand` to `createS3StorageAdapter`.
  - Supabase templates now instantiate `@supabase/supabase-js` via `createClient` and pass it to `createSupabaseStorageAdapter`.
  - LocalFS templates now pass `baseUrl` (instead of `publicBaseUrl`) to `createLocalFsStorageAdapter`.
  - Angular templates now pass `endpoint` (instead of `uploadEndpoint`) to `provideImageUploadConfig`.
  - Nuxt templates now export a valid Nitro `defineEventHandler` using `toWebRequest(event)` for `POST` and `DELETE`.
  - Next.js scaffolds now detect `src/app` vs root `app/` for accurate route paths and relative storage imports.

## [2.2.5] - 2026-11-09

### Fixed

- **CLI `npx img-upload-kit@latest init` Developer Experience**:
  - Eliminated Node.js 22+ `[DEP0190]` deprecation warning on Windows during package installation in `src/cli/init.ts`.
  - Simplified `package.json` `"bin"` to `{"img-upload-kit": "dist/bin.js"}` so `npx img-upload-kit` always resolves `img-upload-kit` directly instead of alphabetically selecting legacy bin aliases.
  - Automatically initializes a minimal `package.json` when running `npx img-upload-kit@latest init` in a brand-new empty directory without a `package.json`, preventing `npm i` from walking up into parent directories or `pnpm add` from failing.
  - Exported `decodeBlurHash` and `isBlurhashValid` from `img-upload-kit/blur` and `img-upload-kit` for non-DOM / Node / SSR consumers alongside `decodeBlurHashToDataURL`.

## [2.2.4] - 2026-11-09

### Changed & Fixed

- **`npx`-First Installation & CLI Enhancements**:
  - Added hero `npx img-upload-kit@latest init` command block at the top of `README.md` (above the fold on `npmjs.com`) and standardized all framework/migration guides on `npx img-upload-kit@latest init`.
  - Routed top-level CLI flags (`npx img-upload-kit -f vue -y`) directly to `init`, auto-installed dependencies when `--yes` is passed, added shorthand aliases (`nextjs`, `nuxt`, `expo`, `r2`), and improved monorepo/Corepack package manager detection.
- **Security, Server & Multi-Platform Parity Hardening**:
  - Hardened SVG CSS obfuscation sanitization (`sanitizeSvg`), single-pass SHA-256 hashing, bounded LRU variant tracking, atomic variant rollback, and deferred client `maxSizeMB` checks until after `transformAsset`.
  - Deduplicated `dist/bin.js` and excluded `.map` files from the published npm tarball (`-47.5%` tarball size).

## [2.2.2] - 2026-11-07

### Added

- **Interactive Terminal Setup Wizard (`npx img-upload-kit init` / `setup`)**:
  - Added zero-dependency terminal UI (`src/cli/tui.ts`, `src/cli/detect.ts`, `src/cli/init.ts`) with arrow-key dropdown menus (`↑`/`↓`, `j`/`k`, `1–6` shortcuts, `Enter`, `Esc` cancel) to select framework (`React / Next.js`, `Vue 3.5+ / Nuxt 4`, `Angular 17–21+`, `React Native / Expo`, `Node.js Server`, `Headless Client`) and storage adapter (`LocalFS`, `S3/R2`, `Supabase`, `Memory`).
  - Auto-detects project framework (`package.json`) and package manager (`npm`, `pnpm`, `yarn`, `bun`), installs only the required framework/storage dependencies, and outputs tailored starter imports.

## [2.2.1] - 2026-11-07

### Changed

- **Developer-First npm & GitHub `README.md`**:
  - Streamlined `README.md` with a 3-step Quick Start (`Install` -> `Add an upload route` -> `Drop in the component`), Use Cases table, collapsible Framework Examples (React, Vue 3 / Nuxt 4, Angular 17+, React Native / Expo, S3/R2/Supabase), real `v2.2` studio screenshots, and canonical GitHub documentation links for `npmjs.com`.
- **Dual-Package Type Resolution & Strict Zero-`any`**:
  - Added `.css.d.cts` sidecars and `typesVersions` in `package.json` for 100% green `publint` and `@arethetypeswrong/cli` (`node10`, `node16 (CJS)`, `node16 (ESM)`, `bundler`).

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
