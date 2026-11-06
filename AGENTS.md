# AGENTS.md — AI Agent Contributor Guide

Reference guide for AI agents and developers working on `img-upload-kit`.

## 1. Core Mission & Guardrails

- **Package**: `img-upload-kit` (standalone npm package at `E:\Personal-Projects\image-upload-kit`).
- **Core Function**: Sharp AVIF/WebP image optimization, client-side pre-upload resize, presigned direct-to-storage uploads, content-hash deduplication, smart size-guarding, social & e-commerce aspect-ratio attention cropping (`1:1`, `4:5`, `9:16`), responsive `srcSet` variants, WebP LQIP & BlurHash generation, 4-edge ambient color extraction, magic-byte & SVG security, pluggable `StorageAdapter`, and multi-platform UI & headless primitives for **React**, **Vue 3 / Nuxt 4**, **Angular 17–21+**, and **React Native / Expo**.
- **Author**: Mo Elsherbiny (`https://www.buildwithsherbo.com/`, GitHub: `@MoElsherbiny`).
- **Strict Hard Constraint**: **Every file across the entire repository MUST remain <= 300 lines**. Enforced by ESLint `max-lines` and `scripts/check-max-lines.mjs`. Never create or modify a file to exceed 300 lines.
- **Strict Type Safety (Zero `any`)**: Never use `any` or `eslint-disable` for `@typescript-eslint/no-explicit-any` anywhere in the repository (`@typescript-eslint/no-explicit-any` is enforced as `'error'`). Always use strict TypeScript types (`unknown`, generics, or explicit interfaces).
- **Zero Framework Lock-in & Zero Runtime Dependencies**: Keep `package.json` `"dependencies": {}` empty (`blurhash` is bundled into `dist/`, and `sharp` / `lqip-modern` are optional peer dependencies loaded lazily on the server). React components must never import `next/*` directly; Vue components in `src/vue` use peer `vue`; Angular controllers in `src/angular` must not require `@angular/core` at runtime; React Native components in `src/react-native` must never reference DOM globals (`window`, `document`, `HTMLImageElement`).

## 2. Architecture & Subpath Structure

```
src/
├── index.ts                  # Root subpath '.' — Universal types, presets, aspectRatio, validators, formatters, blur helpers
├── types/                    # Pure domain types (quality, presets, aspectRatio, upload contracts, ImageVariant)
│   ├── aspectRatio.ts        # ImageAspectRatio ('1:1'|'4:5'|'9:16'|...), CropStrategy, resolveAspectRatio, aspectRatioToCss
│   ├── quality.ts            # Quality presets & dimension configurations
│   ├── presets.ts            # STANDARD_PRESETS (incl. square, portrait, story), defineUploadPresets, allowSvg, variantWidths
│   └── upload.ts             # UploadedImageData (incl. deduplicated?), ImageVariant & request parameters
├── core/                     # Shared framework-agnostic UI & upload primitives
│   ├── placeholders.ts       # Shared SVG fallback, BlurHash decode & CSS background color resolvers
│   ├── pointerReorder.ts     # attachPointerReorder pointer-events drag-and-drop gallery reorder enhancer
│   └── uploadPipeline.ts     # Shared framework-agnostic client upload, validation, preview & delete helpers
├── i18n/                     # Shared English (en) & Arabic (ar) translations + pluralization + cover/reorder labels
├── utils/                    # Pure utilities (zero dependencies, side-effect free)
│   ├── color.ts              # 4-edge RGB/HEX parsing and contrast calculations
│   ├── formatters.ts         # Byte sizes, filenames, MIME types, extensions, error mapping
│   └── validators.ts         # File size, dimensions, format guards
├── client/                   # Subpath './client' — Universal client upload engine (Web + Vue + Angular + React Native)
│   ├── types.ts              # NativeUploadAsset, UploadableAsset, TransformAssetFn, UploadMode, MultiUploadReorderApi
│   ├── asset.ts              # normalizeUploadableAsset, isNativeAsset, appendAssetToFormData
│   ├── reorder.ts            # Immutable moveItem & promoteToCover gallery helpers
│   ├── transform.ts          # runTransformAsset with AbortSignal enforcement
│   ├── resize.ts             # createClientResizeTransform (createImageBitmap + OffscreenCanvas) & composeTransforms
│   ├── presignedUpload.ts    # uploadViaPresignedUrl two-phase presign -> storage -> finalize flow
│   ├── uploadAsset.ts        # uploadAsset dispatcher ('direct' | 'presigned')
│   ├── deleteRequest.ts      # deleteUploadedImage opt-in DELETE helper
│   ├── xhrUpload.ts          # Universal XMLHttpRequest FormData uploader (File, Blob & RN { uri, name, type })
│   ├── uploadTracker.ts      # Monotonic progress aggregator across parallel uploads
│   └── uploadQueue.ts        # Bounded concurrency upload queue
├── storage/                  # Subpath './storage' — Pluggable storage adapters (s3Adapter, supabaseAdapter, localFsAdapter, memoryAdapter)
├── blur/                     # Subpath './blur' — BlurService, BlurHash decoder, fallback SVG builders, LRUCache
├── server/                   # Subpaths './server' & './server/handler'
│   ├── semaphore.ts          # Concurrency throttling, queue bounds & AbortSignal for Sharp
│   ├── handler/              # Web Standard Request / FormData + presignRoute.ts, finalizeRoute.ts, uploadToken.ts (edge-safe entry)
│   ├── security/             # Magic-byte detector (sniffFormat.ts) & allowlist SVG sanitizer (sanitizeSvg.ts)
│   ├── optimization/         # Sharp AVIF/WebP optimizer, smart aspect crop, single-decode LQIP/BlurHash/4-edge color
│   └── uploader/             # createImageUploader, dedupe.ts, pathGenerator.ts, uploadRetry.ts, variantGenerator.ts
├── cli/                      # Subpath './cli' & bin 'dist/bin.js' — Manifest generator CLI
├── react/                    # Subpaths './react' & './headless'
│   ├── types.ts, styling.ts  # Component props, reorderable/showCoverBadge/transformAsset/uploadMode, 4-tier slot types
│   ├── icons.tsx             # Zero-dependency inlined SVG icons (no lucide-react)
│   ├── context.tsx           # Shared ImageUploadProvider singleton across /react & /headless
│   ├── hooks/                # XHR/presigned upload tracker, queue, clipboard paste, dialog focus trap
│   ├── components/           # Dropzones, MultiImageGrid (pointer reorder), PreviewTile, Modals, AnimatedImage, BlurImage
│   ├── headless/             # Headless hooks & render-prop primitives (useSingleUpload, useMultiUpload)
│   └── styles/               # Modular CSS layers (bundled to dist/styles.css & dist/styles/*.css)
├── vue/                      # Subpath './vue' — Vue 3.5+ & Nuxt 4 plugin, composables, components & headless slots
│   ├── config.ts             # createImageUpload plugin, provideImageUploadConfig (provideImageUpload), useImageUploadConfig
│   ├── composables/          # useSingleUpload.ts, useMultiUpload.ts, useImageReveal.ts, uploadHelpers.ts
│   └── components/           # AnimatedImage.ts, SingleImageUpload.ts, MultiImageUpload.ts, Headless.ts, UploadComponents.ts
├── angular/                  # Subpath './angular' — Angular 17–21+ reactive controllers, signals bridge & DOM helpers
│   ├── config.ts             # provideImageUploadConfig, IMAGE_UPLOAD_CONFIG_TOKEN, resolveImageUploadConfig
│   ├── signals.ts            # createSignal & createComputed reactive primitives
│   ├── withAngularSignals.ts # withAngularSignals Zoneless Angular Signal bridge
│   ├── controllers/          # singleUpload.ts, multiUpload.ts, multiUploadOps.ts, imageReveal.ts, uploadHelpers.ts
│   └── components/           # animatedImage.ts, singleUploadElement.ts, multiUploadElement.ts, uploadElements.ts, domHelpers.ts
└── react-native/             # Subpath './react-native' — Expo & Bare React Native components, hooks & pickers
    ├── context.tsx           # NativeImageUploadProvider & useNativeImageUploadConfig
    ├── pickers.ts            # createExpoImagePickerAdapter, createRnImagePickerAdapter, createExpoManipulatorResizeTransform
    ├── hooks/                # useNativeUpload, useNativeSingleUpload, useNativeMultiUpload
    ├── components/           # AnimatedImage, SingleImageUpload, MultiImageUpload
    └── theme.ts              # defaultNativeTheme, lightNativeTheme, darkNativeTheme
```

## 3. Presets, Security & Storage Contracts

- **No Domain Categories**: Never hardcode app-specific categories like `'homepage'`, `'brochure'`, or `'admin-profile'`. Use standard visual roles: `thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`, `square` (`1:1`), `portrait` (`4:5`), `story` (`9:16`).
- **Security by Default**: SVG is disabled unless `allowSvg: true` (which sanitizes via `sanitizeSvg`). Every upload is checked with `sniffImageFormat`. Client `FormData` overrides require `allowClientOverrides` in `createUploadHttpHandler`.
- **Storage**: Implementations adhere strictly to `StorageAdapter`: `upload(params)`, `delete(bucket, path)`, optional `exists?(bucket, path)`, `stat?(bucket, path)`, `getPublicUrl?(bucket, path)`, `list?(bucket, folder?, options?)`, `deleteByUrl?(url)`, `parseUrl?(url)`, `createPresignedUpload?(params)`, and `download?(bucket, path, options?)`.

## 4. The 4 UI Styling Tiers & Multi-Platform Parity

1. **Tier 1 (CSS Tokens / Native Theme)**: `--iuk-*` CSS custom properties (React, Vue & Angular) and `defaultNativeTheme` (React Native) with dark mode, RTL support, and `prefers-reduced-motion`.
2. **Tier 2 (Unstyled + Slots)**: `unstyled?: boolean`, per-slot `classNames` & `styles`, `data-slot`, and `data-state="idle|dragging|uploading|ready|error|disabled"`. Hidden file inputs MUST retain `HIDDEN_INPUT_STYLE`.
3. **Tier 3 (Slot Renderers)**: Partial custom renderers (`renderDropzone`, `renderPreview`, `renderHeader`, `renderEmptyDropzone`, `renderTile`, `renderAddMore`).
4. **Tier 4 (Headless Primitives)**: Zero-opinion controllers across React (`img-upload-kit/headless`), Vue (`img-upload-kit/vue`), Angular (`img-upload-kit/angular`), and React Native (`img-upload-kit/react-native`).

## 5. Verification Commands

Before concluding any work, verify all checks pass:
```bash
node scripts/check-max-lines.mjs # Enforces <= 300 lines across every file in the repo
npm run typecheck                # Must pass with zero TypeScript errors
npm run lint                     # Must pass with zero ESLint errors (enforces max-lines <= 300)
npm test                         # Must pass all Vitest suites (Node + jsdom)
npm run build                    # Builds dist/ (ESM, CJS, .d.ts, .d.cts, dist/styles.css, dist/styles/*.css)
node scripts/check-dist.mjs      # Verifies 'use client', singletons, dependency graph, and exports
```
