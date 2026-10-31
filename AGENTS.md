# AGENTS.md — AI Agent Contributor Guide

Reference guide for AI agents and developers working on `image-upload-kit`.

## 1. Core Mission & Guardrails

- **Package**: `image-upload-kit` (standalone npm package at `E:\Personal-Projects\image-upload-kit`).
- **Core Function**: Sharp AVIF/WebP image optimization, smart size-guarding, WebP LQIP & BlurHash generation, 4-edge ambient color extraction, pluggable `StorageAdapter`, and flexible React + Headless UI components.
- **Author**: Mo Elsherbiny (`https://www.buildwithsherbo.com/`, GitHub: `@MoElsherbiny`).
- **Strict Hard Constraint**: **Every file across the entire repository MUST remain <= 300 lines**. Enforced by ESLint `max-lines`. Never create or modify a file to exceed 300 lines.
- **Zero Framework Lock-in**: Keep core and server logic framework-agnostic. React components must never import `next/*` directly; allow consumers to plug in Next.js via `as={Image}` or `renderImage`.

## 2. Architecture & Subpath Structure

```
src/
├── index.ts               # Root subpath '.' — Universal types, presets, validators, formatters, blur helpers
├── types/                 # Pure domain types (quality, presets, upload contracts)
│   ├── quality.ts         # Quality presets & dimension configurations
│   ├── presets.ts         # STANDARD_PRESETS & defineUploadPresets
│   └── upload.ts          # UploadedImageData & request parameters
├── utils/                 # Pure utilities (zero dependencies, side-effect free)
│   ├── color.ts           # 4-edge RGB/HEX parsing and contrast calculations
│   ├── formatters.ts      # Byte sizes, filenames, MIME types, extensions
│   └── validators.ts      # File size, dimensions, format guards
├── storage/               # Subpath './storage' — Pluggable storage adapters
│   ├── types.ts           # StorageAdapter interface & options
│   ├── s3Adapter.ts       # AWS S3 / Cloudflare R2 / MinIO adapter
│   ├── supabaseAdapter.ts # Supabase Storage adapter
│   ├── localFsAdapter.ts  # Node.js local filesystem adapter
│   ├── memoryAdapter.ts   # In-memory storage adapter (unit testing)
│   └── urlParser.ts       # Storage URL resolution & validation
├── blur/                  # Subpath './blur' — Blur & placeholder generation
│   ├── types.ts           # BlurService interfaces & options
│   ├── blurService.ts     # Client & isomorphic BlurService
│   ├── blurDataUtils.ts   # Client-side BlurHash canvas decoding
│   ├── placeholders.ts    # Fallback blur patterns & SVG builders
│   ├── pathMapper.ts      # Storage key to manifest path mapping
│   └── lruCache.ts        # Fast LRU cache for blur payloads
├── server/                # Subpath './server' — Server-only processing (Sharp)
│   ├── handler.ts         # Web Standard Request / FormData HTTP handler
│   ├── semaphore.ts       # Concurrency throttling for Sharp pipelines
│   ├── optimization/      # Sharp AVIF/WebP optimizer, size-guards, color histogram
│   └── uploader/          # createImageUploader, path generators, collision retry
├── cli/                   # Subpath './cli' — CLI manifest generator & validator
│   ├── commands.ts        # Commander.js CLI commands
│   ├── generator.ts       # Blur manifest build pipeline
│   ├── scanner.ts         # Directory asset scanner
│   └── validation.ts      # Manifest schema & integrity checks
└── react/                 # Subpath './react' & './headless'
    ├── types.ts, styling.ts, slotStyles.ts
    ├── context.tsx        # ImageUploadProvider (theming, unstyled, classNames)
    ├── i18n/              # English (en) & Arabic (ar) translations
    ├── hooks/             # XHR upload progress, drag-and-drop, state hooks
    ├── components/        # Dropzones, Tiles, Modals, AnimatedImage, BlurImage
    ├── headless/          # Headless hooks & render-prop primitives
    └── styles/            # Modular CSS tokens & layers (bundled to dist/styles.css)
```

## 3. Presets & Storage Contracts

- **No Domain Categories**: Never hardcode app-specific categories like `'homepage'`, `'brochure'`, or `'admin-profile'`. Use standard visual roles: `thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`.
- **Extensibility**: Users declare custom presets with `defineUploadPresets({...})` and optional global TypeScript autocomplete via `UploadKitRegister` module augmentation.
- **Storage**: Implementations adhere strictly to `StorageAdapter`: `upload(file, path, options)`, `delete(path)`, `getPublicUrl(path)`, `list(prefix)`, `deleteByUrl(url)`.

## 4. The 4 UI Styling Tiers

1. **Tier 1 (CSS Tokens)**: `--iuk-*` CSS custom properties with automatic dark mode & RTL support.
2. **Tier 2 (Unstyled + Slots)**: `unstyled?: boolean`, per-slot `classNames` & `styles`, `data-slot`, and `data-state="idle|dragging|uploading|ready|error|disabled"`. Hidden file inputs MUST retain `HIDDEN_INPUT_STYLE`.
3. **Tier 3 (Slot Renderers)**: Partial custom renderers (`renderDropzone`, `renderPreview`, `renderHeader`, `renderEmptyDropzone`, `renderTile`, `renderAddMore`).
4. **Tier 4 (Headless Primitives)**: Zero-opinion hooks & render-props (`useSingleUpload`, `useMultiUpload`, `<HeadlessSingleUpload>`, `<HeadlessMultiUpload>`) from `image-upload-kit/headless`.

## 5. AnimatedImage Component

- **Location**: `src/react/components/AnimatedImage/`.
- **Behavior**: Instant blur-up crossfade using LQIP data URL > BlurHash > dominant color SVG gradient. Pre-decodes via `img.decode()` to eliminate render hitch. Unmounts placeholder after crossfade. Supports `as={Image}` for Next.js and `showShimmer`.

## 6. Verification Commands

Before concluding any work, verify:
```bash
npm run typecheck      # Must pass with zero TypeScript errors
npm run lint           # Must pass with zero ESLint errors
npm test               # Must pass all Vitest suites
npm run build          # Builds dist/ (ESM, CJS, .d.ts, dist/styles.css)
```
