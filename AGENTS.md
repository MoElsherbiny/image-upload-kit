# AGENTS.md — AI Agent Contributor Guide

Reference guide for AI agents and developers working on `img-upload-kit`.

## 1. Core Mission & Guardrails

- **Package**: `img-upload-kit` (standalone npm package at `E:\Personal-Projects\image-upload-kit`).
- **Core Function**: Sharp AVIF/WebP image optimization, smart size-guarding, responsive `srcSet` variants, WebP LQIP & BlurHash generation, 4-edge ambient color extraction, magic-byte & SVG security, pluggable `StorageAdapter`, and flexible React + Headless UI components.
- **Author**: Mo Elsherbiny (`https://www.buildwithsherbo.com/`, GitHub: `@MoElsherbiny`).
- **Strict Hard Constraint**: **Every file across the entire repository MUST remain <= 300 lines**. Enforced by ESLint `max-lines`. Never create or modify a file to exceed 300 lines.
- **Zero Framework Lock-in**: Keep core and server logic framework-agnostic. React components must never import `next/*` directly; allow consumers to plug in Next.js via `as={Image}` or `renderImage`. `sharp` and `lqip-modern` are optional peer dependencies loaded lazily on the server.

## 2. Architecture & Subpath Structure

```
src/
├── index.ts                  # Root subpath '.' — Universal types, presets, validators, formatters, blur helpers
├── types/                    # Pure domain types (quality, presets, upload contracts, ImageVariant)
│   ├── quality.ts            # Quality presets & dimension configurations
│   ├── presets.ts            # STANDARD_PRESETS, defineUploadPresets, allowSvg, variantWidths
│   └── upload.ts             # UploadedImageData, ImageVariant & request parameters
├── utils/                    # Pure utilities (zero dependencies, side-effect free)
│   ├── color.ts              # 4-edge RGB/HEX parsing and contrast calculations
│   ├── formatters.ts         # Byte sizes, filenames, MIME types, extensions, error mapping
│   └── validators.ts         # File size, dimensions, format guards
├── storage/                  # Subpath './storage' — Pluggable storage adapters
│   ├── types.ts              # StorageAdapter interface (upload, delete, list pagination, exists)
│   ├── s3Adapter.ts          # AWS S3 / Cloudflare R2 / MinIO adapter
│   ├── supabaseAdapter.ts    # Supabase Storage adapter
│   ├── localFsAdapter.ts     # Node.js local filesystem adapter (containment + atomic wx)
│   ├── memoryAdapter.ts      # In-memory storage adapter (unit testing)
│   └── urlParser.ts          # Storage URL resolution & validation
├── blur/                     # Subpath './blur' — Blur & placeholder generation
│   ├── types.ts              # BlurService interfaces & options
│   ├── blurService.ts        # Client & isomorphic BlurService
│   ├── blurDataUtils.ts      # Client-side BlurHash canvas decoding, srcSet & preload helpers
│   ├── placeholders.ts       # Fallback blur patterns & SVG builders
│   ├── pathMapper.ts         # Storage key to manifest path mapping
│   └── lruCache.ts           # Fast LRU cache for blur payloads
├── server/                   # Subpaths './server' & './server/handler'
│   ├── semaphore.ts          # Concurrency throttling, queue bounds & AbortSignal for Sharp
│   ├── handler/              # Web Standard Request / FormData HTTP handler (edge-safe entry)
│   │   ├── index.ts          # createUploadHttpHandler (POST & DELETE)
│   │   ├── options.ts        # UploadHttpHandlerOptions, AuthorizeContext, allowClientOverrides
│   │   ├── guards.ts         # maxBodyBytes stream limiter, allowedOrigins, authorize wrapper
│   │   ├── parseUploadForm.ts# FormData parsing, preset clamping & strict quality validation
│   │   ├── deleteRoute.ts    # DELETE bucket allowlist & URL resolution
│   │   └── responses.ts      # Sanitized JSON responses & onError hook
│   ├── security/             # Binary format sniffing & SVG sanitization
│   │   ├── sniffFormat.ts    # Magic-byte detector (JPEG, PNG, GIF, WebP, AVIF/HEIF, TIFF, SVG)
│   │   └── sanitizeSvg.ts    # Dependency-free allowlist SVG sanitizer
│   ├── optimization/         # Sharp AVIF/WebP optimizer, single-decode LQIP/BlurHash/4-edge color
│   └── uploader/             # createImageUploader, pathGenerator, uploadRetry, variantGenerator.ts
├── cli/                      # Subpath './cli' & bin 'dist/bin.js'
│   ├── bin.ts                # Dedicated CLI binary entry point
│   ├── index.ts              # Side-effect-free programmatic CLI exports
│   ├── commands.ts           # Commander.js CLI commands (generate, validate, sync, cleanup, health)
│   ├── generator.ts          # Blur manifest build pipeline
│   ├── scanner.ts            # Directory asset scanner
│   └── validation.ts         # Manifest schema & integrity checks
└── react/                    # Subpaths './react' & './headless'
    ├── types.ts, styling.ts  # Component props, ImageUploadHandle, 4-tier slot types
    ├── icons.tsx             # Zero-dependency inlined SVG icons (no lucide-react)
    ├── context.tsx           # Shared ImageUploadProvider singleton across /react & /headless
    ├── i18n/                 # English (en) & Arabic (ar) translations + pluralization
    ├── hooks/                # XHR upload tracker, queue, clipboard paste, dialog focus trap
    ├── components/           # Dropzones, PreviewTile, Modals, AnimatedImage, BlurImage
    ├── headless/             # Headless hooks & render-prop primitives
    └── styles/               # Modular CSS layers (bundled to dist/styles.css & dist/styles/*.css)
tests/
├── *.test.{ts,tsx}           # Node & SSR test suites (security, server, variants, storage, CLI, dist)
├── dom/*.test.tsx            # jsdom + Testing Library behavioral & accessibility suites
└── helpers/                  # mockXhr.ts & Sharp imageFixtures.ts
scripts/
└── check-dist.mjs            # Build integrity verifier ('use client', context singleton, exports)
```

## 3. Presets, Security & Storage Contracts

- **No Domain Categories**: Never hardcode app-specific categories like `'homepage'`, `'brochure'`, or `'admin-profile'`. Use standard visual roles: `thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`.
- **Security by Default**: SVG is disabled unless `allowSvg: true` (which sanitizes via `sanitizeSvg`). Every upload is checked with `sniffImageFormat`. Client `FormData` overrides require `allowClientOverrides` in `createUploadHttpHandler`.
- **Storage**: Implementations adhere strictly to `StorageAdapter`: `upload(file, path, options)`, `delete(path)`, `getPublicUrl(path)`, `list(prefix, options?)`, `deleteByUrl(url)`, and optional `exists?(path)`.

## 4. The 4 UI Styling Tiers

1. **Tier 1 (CSS Tokens)**: `--iuk-*` CSS custom properties with automatic dark mode, RTL support, and `prefers-reduced-motion`.
2. **Tier 2 (Unstyled + Slots)**: `unstyled?: boolean`, per-slot `classNames` & `styles`, `data-slot`, and `data-state="idle|dragging|uploading|ready|error|disabled"`. Hidden file inputs MUST retain `HIDDEN_INPUT_STYLE`.
3. **Tier 3 (Slot Renderers)**: Partial custom renderers (`renderDropzone`, `renderPreview`, `renderHeader`, `renderEmptyDropzone`, `renderTile`, `renderAddMore`).
4. **Tier 4 (Headless Primitives)**: Zero-opinion hooks & render-props (`useSingleUpload`, `useMultiUpload`, `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`) from `img-upload-kit/headless`.

## 5. AnimatedImage Component

- **Location**: `src/react/components/AnimatedImage/`.
- **Behavior**: 600 ms settle reveal (`opacity: 0 -> 1` + `scale(1.02 -> 1)`, configurable via `revealScale` and `animationDuration`). Uses LQIP data URL > BlurHash > flat `blurColor` background (`colorPlaceholder="gradient"` opt-in for SVG gradient). Pre-decodes via `img.decode()`, unmounts placeholder after fade (`duration + 50ms`), preserves placeholder on error with `fallbackSrc` & `renderError`, auto-wires `image.variants` `srcSet`, and supports Next.js `as={Image}` with first-class `priority` and `quality` props.

## 6. Verification Commands

Before concluding any work, verify all 5 checks pass:
```bash
npm run typecheck          # Must pass with zero TypeScript errors
npm run lint               # Must pass with zero ESLint errors (enforces max-lines <= 300)
npm test                   # Must pass all Vitest suites (Node + jsdom)
npm run build              # Builds dist/ (ESM, CJS, .d.ts, .d.cts, dist/styles.css, dist/styles/*.css)
node scripts/check-dist.mjs # Verifies 'use client', singletons, dependency graph, and exports
```
