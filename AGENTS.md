# AGENTS.md — AI Agent Contributor Guide

Reference guide for AI agents and developers working on `img-upload-kit`.

## 1. Core Mission & Guardrails

- **Package**: `img-upload-kit` (standalone npm package at `E:\Personal-Projects\image-upload-kit`).
- **Core Function**: Sharp AVIF/WebP image optimization, smart size-guarding, social & e-commerce aspect-ratio attention cropping (`1:1`, `4:5`, `9:16`), responsive `srcSet` variants, WebP LQIP & BlurHash generation, 4-edge ambient color extraction, magic-byte & SVG security, pluggable `StorageAdapter`, and multi-platform UI & headless primitives for **React**, **Angular**, and **React Native / Expo**.
- **Author**: Mo Elsherbiny (`https://www.buildwithsherbo.com/`, GitHub: `@MoElsherbiny`).
- **Strict Hard Constraint**: **Every file across the entire repository MUST remain <= 300 lines**. Enforced by ESLint `max-lines` and `scripts/check-max-lines.mjs`. Never create or modify a file to exceed 300 lines.
- **Zero Framework Lock-in**: Keep core, client, and server logic framework-agnostic. React components must never import `next/*` directly; Angular controllers in `src/angular` must not require `@angular/core` at runtime; React Native components in `src/react-native` must never reference DOM globals (`window`, `document`, `HTMLImageElement`). `sharp` and `lqip-modern` are optional peer dependencies loaded lazily on the server.

## 2. Architecture & Subpath Structure

```
src/
├── index.ts                  # Root subpath '.' — Universal types, presets, aspectRatio, validators, formatters, blur helpers
├── types/                    # Pure domain types (quality, presets, aspectRatio, upload contracts, ImageVariant)
│   ├── aspectRatio.ts        # ImageAspectRatio ('1:1'|'4:5'|'9:16'|...), CropStrategy, resolveAspectRatio, aspectRatioToCss
│   ├── quality.ts            # Quality presets & dimension configurations
│   ├── presets.ts            # STANDARD_PRESETS (incl. square, portrait, story), defineUploadPresets, allowSvg, variantWidths
│   └── upload.ts             # UploadedImageData, ImageVariant & request parameters
├── utils/                    # Pure utilities (zero dependencies, side-effect free)
│   ├── color.ts              # 4-edge RGB/HEX parsing and contrast calculations
│   ├── formatters.ts         # Byte sizes, filenames, MIME types, extensions, error mapping
│   └── validators.ts         # File size, dimensions, format guards
├── client/                   # Subpath './client' — Universal client upload engine (Web + Angular + React Native)
│   ├── types.ts              # NativeUploadAsset, UploadableAsset, TransformAssetFn, MultiUploadReorderApi
│   ├── asset.ts              # normalizeUploadableAsset, isNativeUploadAsset, appendUploadAssetToFormData
│   ├── reorder.ts            # Immutable moveItem & promoteToCover gallery helpers
│   ├── transform.ts          # runTransformAsset with AbortSignal enforcement
│   ├── xhrUpload.ts          # Universal XMLHttpRequest FormData uploader (File, Blob & RN { uri, name, type })
│   ├── uploadTracker.ts      # Monotonic progress aggregator across parallel uploads
│   └── uploadQueue.ts        # Bounded concurrency upload queue
├── storage/                  # Subpath './storage' — Pluggable storage adapters (S3/R2, Supabase, LocalFS, Memory)
├── blur/                     # Subpath './blur' — BlurService, BlurHash decoder, fallback SVG builders, LRUCache
├── server/                   # Subpaths './server' & './server/handler'
│   ├── semaphore.ts          # Concurrency throttling, queue bounds & AbortSignal for Sharp
│   ├── handler/              # Web Standard Request / FormData HTTP handler (edge-safe entry)
│   ├── security/             # Magic-byte detector (sniffFormat.ts) & allowlist SVG sanitizer (sanitizeSvg.ts)
│   ├── optimization/         # Sharp AVIF/WebP optimizer, smart aspect crop, single-decode LQIP/BlurHash/4-edge color
│   └── uploader/             # createImageUploader, pathGenerator, uploadRetry, variantGenerator
├── cli/                      # Subpath './cli' & bin 'dist/bin.js' — Manifest generator CLI
├── react/                    # Subpaths './react' & './headless'
│   ├── types.ts, styling.ts  # Component props, reorderable/showCoverBadge/transformAsset, 4-tier slot types
│   ├── icons.tsx             # Zero-dependency inlined SVG icons (no lucide-react)
│   ├── context.tsx           # Shared ImageUploadProvider singleton across /react & /headless
│   ├── i18n/                 # English (en) & Arabic (ar) translations + pluralization + cover/reorder labels
│   ├── hooks/                # XHR upload tracker, queue, clipboard paste, dialog focus trap
│   ├── components/           # Dropzones, PreviewTile (with Cover badge & reorder), Modals, AnimatedImage, BlurImage
│   ├── headless/             # Headless hooks & render-prop primitives (useSingleUpload, useMultiUpload)
│   └── styles/               # Modular CSS layers (bundled to dist/styles.css & dist/styles/*.css)
├── angular/                  # Subpath './angular' — Angular 17–19+ reactive controllers & standalone helpers
│   ├── config.ts             # provideImageUploadConfig, IMAGE_UPLOAD_CONFIG, resolveImageUploadConfig
│   ├── createSingleUpload.ts # Reactive single-upload controller + toControlValueAccessor()
│   ├── createMultiUpload.ts  # Reactive multi-upload controller with move(), setCover(), retry(), cancel()
│   ├── createImageReveal.ts  # Progressive blur-up state machine + mountAnimatedImage DOM helper
│   └── components.ts         # AnimatedImageComponent, SingleImageUploadComponent, MultiImageUploadComponent
└── react-native/             # Subpath './react-native' — Expo & Bare React Native components, hooks & pickers
    ├── context.tsx           # NativeImageUploadProvider & useNativeImageUploadConfig
    ├── pickers.ts            # createExpoImagePickerAdapter & createRnImagePickerAdapter (HEIC -> JPEG)
    ├── useNativeSingleUpload.ts
    ├── useNativeMultiUpload.ts
    ├── AnimatedImage.tsx     # React Native Animated.View blur-up + expo-image as={Image} + contain backdrop
    ├── SingleImageUpload.tsx # Native single-upload card with camera/library actions & progress bar
    ├── MultiImageUpload.tsx  # Native gallery grid with Cover badge & reorder buttons
    └── theme.ts              # defaultNativeTheme, lightNativeTheme, darkNativeTheme
```

## 3. Presets, Security & Storage Contracts

- **No Domain Categories**: Never hardcode app-specific categories like `'homepage'`, `'brochure'`, or `'admin-profile'`. Use standard visual roles: `thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`, `square` (`1:1`), `portrait` (`4:5`), `story` (`9:16`).
- **Security by Default**: SVG is disabled unless `allowSvg: true` (which sanitizes via `sanitizeSvg`). Every upload is checked with `sniffImageFormat`. Client `FormData` overrides require `allowClientOverrides` in `createUploadHttpHandler`.
- **Storage**: Implementations adhere strictly to `StorageAdapter`: `upload(file, path, options)`, `delete(path)`, `getPublicUrl(path)`, `list(prefix, options?)`, `deleteByUrl(url)`, and optional `exists?(path)`.

## 4. The 4 UI Styling Tiers & Multi-Platform Parity

1. **Tier 1 (CSS Tokens / Native Theme)**: `--iuk-*` CSS custom properties (React & Angular) and `defaultNativeTheme` (React Native) with dark mode, RTL support, and `prefers-reduced-motion`.
2. **Tier 2 (Unstyled + Slots)**: `unstyled?: boolean`, per-slot `classNames` & `styles`, `data-slot`, and `data-state="idle|dragging|uploading|ready|error|disabled"`. Hidden file inputs MUST retain `HIDDEN_INPUT_STYLE`.
3. **Tier 3 (Slot Renderers)**: Partial custom renderers (`renderDropzone`, `renderPreview`, `renderHeader`, `renderEmptyDropzone`, `renderTile`, `renderAddMore`).
4. **Tier 4 (Headless Primitives)**: Zero-opinion controllers across React (`img-upload-kit/headless`), Angular (`img-upload-kit/angular`), and React Native (`img-upload-kit/react-native`).

## 5. Verification Commands

Before concluding any work, verify all 5 checks pass:
```bash
npm run typecheck          # Must pass with zero TypeScript errors
npm run lint               # Must pass with zero ESLint errors (enforces max-lines <= 300)
npm test                   # Must pass all Vitest suites (Node + jsdom)
npm run build              # Builds dist/ (ESM, CJS, .d.ts, .d.cts, dist/styles.css, dist/styles/*.css)
node scripts/check-dist.mjs # Verifies 'use client', singletons, dependency graph, and exports
```
