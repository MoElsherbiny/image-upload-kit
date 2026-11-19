# AGENTS.md — AI Agent Contributor Guide

Reference guide for AI agents and developers working on `img-upload-kit`.

## 1. Core Mission & Guardrails

- **Package**: `img-upload-kit` (standalone npm package at `E:\Personal-Projects\image-upload-kit`).
- **Core Function**: Sharp AVIF/WebP image optimization, client-side pre-upload resize, presigned/resumable/multipart uploads, ref-counted content-hash deduplication, smart size-guarding, social & e-commerce aspect-ratio & `focalPoint` cropping (`1:1`, `4:5`, `9:16`), responsive `srcSet` variants, WebP LQIP & BlurHash generation, 4-edge ambient color extraction, magic-byte & strict XML allowlist SVG security, pluggable `StorageAdapter` + `migrateStorage`, 4-layer zero-dep CLI, and multi-platform UI & headless primitives for **React**, **Vue 3 / Nuxt 4**, **Angular 17–21+**, and **React Native / Expo**.
- **Author**: Mo Elsherbiny (`https://www.buildwithsherbo.com/`, GitHub: `@MoElsherbiny`).
- **Strict Hard Constraint**: **Every file across the entire repository MUST remain <= 300 lines**. Enforced by ESLint `max-lines` and `scripts/check-max-lines.mjs`. Never create or modify a file to exceed 300 lines, and never store internal planning documents in the repository.
- **Strict Type Safety (Zero `any`)**: Never use `any` or `eslint-disable` for `@typescript-eslint/no-explicit-any` anywhere in the repository (`@typescript-eslint/no-explicit-any` is enforced as `'error'`).
- **Zero Framework Lock-in & Zero Runtime Dependencies**: Keep `package.json` `"dependencies": {}` empty (`blurhash` is bundled into `dist/`, and `sharp` is an optional peer dependency loaded lazily on the server). React components must never import `next/*` directly; Vue components in `src/vue` use peer `vue`; Angular controllers in `src/angular` must not require `@angular/core` at runtime; React Native components in `src/react-native` must never reference DOM globals (`window`, `document`, `HTMLImageElement`).

## 2. Architecture, Subpath & Test Structure

```text
src/
├── index.ts                  # Root subpath '.' — Universal types, presets, aspectRatio, UploadKitError, validators, blur helpers
├── types/                    # Pure domain types (aspectRatio, errors, rateLimit, quality, presets, upload)
├── core/                     # Shared placeholders.ts, pointerReorder.ts, uploadPipeline.ts
├── i18n/                     # Shared English (en) & Arabic (ar) translations + pluralization + cover/reorder labels
├── utils/                    # Pure utilities: color.ts, formatters.ts, validators.ts
├── client/                   # './client' — asset, reorder, transform, resize, presignedUpload, resumableUpload,
│                             #   multipartUpload, retry, uploadAsset, deleteRequest, xhrUpload, uploadTracker, uploadQueue
├── storage/                  # './storage' — s3Adapter, supabaseAdapter, localFsAdapter, memoryAdapter, migration, errorNormalizer
├── blur/                     # './blur' — BlurService, bundled BlurHash decoder, placeholders, pathMapper, LRUCache
├── server/                   # './server' & './server/handler'
│   ├── semaphore.ts          # Concurrency throttling, queue bounds & AbortSignal for Sharp
│   ├── handler/              # Direct/presign/finalize/delete, resumableRoute + resumableStore, multipartRoute + multipartStore,
│   │                         #   streamBody, uploadToken (rotation + sub + release), rateLimitGuard, memoryRateLimiter
│   ├── security/             # sniffFormat, XML allowlist SVG sanitizer (svgTokenizer/svgAllowlist/sanitizeSvg), imageLimits
│   ├── optimization/         # Sharp AVIF/WebP optimizer, resizePlan (focalPoint), sRGB, formatNegotiator, transformCache, LQIP
│   └── uploader/             # createImageUploader, dedupe.ts, inFlightCoalescer.ts, pathGenerator.ts, uploadRetry.ts, variantGenerator.ts
├── cli/                      # './cli' & bin 'dist/bin.js' — ZeroDepCliProgram, 4-layer detection, init, doctor, validate, agents, config
├── react/                    # './react' & './headless' — Components, hooks, slot styling, inlined SVG icons, styles/*.css
├── vue/                      # './vue' — Vue 3.5+ & Nuxt 4 plugin, composables, AnimatedImage, Single/Multi/Headless components
├── angular/                  # './angular' — Angular 17–21+ controllers, signals, withAngularSignals, CVA & DOM mounters
└── react-native/             # './react-native' — NativeImageUploadProvider, Expo/RN pickers, hooks, components & themes

tests/                        # '*.dom.test.{ts,tsx}' runs in jsdom; all other '*.test.{ts,tsx}' run in node
├── unit/                     # Isolated unit suites: core/, client/, storage/, server/
├── frameworks/               # UI & controller suites: react/, headless/, vue/, angular/, react-native/
├── cli/                      # 4-layer detection, scaffolds, doctor/validate/agents/config, blur manifest CLI suites
├── security/                 # SVG adversarial XML, token lifecycle, magic-byte/pixel limits, rate limiting, route hardening
├── integration/              # Framework parity, Node HTTP servers, presigned, resumable, and multipart flows
├── e2e/                      # Live node:http + Sharp + LocalFS full-stack UI framework & CLI lifecycle tests
├── packaging/                # dist/ smoke, npm pack tarball inspection, doc-examples-typecheck.test.ts
└── helpers/                  # Shared deterministic Sharp fixtures, XHR/RN stubs, liveTestServer
```

## 3. Presets, Security & Storage Contracts

- **No Domain Categories**: Never hardcode app-specific categories like `'homepage'`, `'brochure'`, or `'admin-profile'`. Use standard visual roles: `thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`, `square` (`1:1`), `portrait` (`4:5`), `story` (`9:16`).
- **Security by Default**: SVG is disabled unless `allowSvg: true` (sanitized via zero-dep XML tokenizer + strict allowlist in `svgTokenizer.ts`, `svgAllowlist.ts`, `sanitizeSvg.ts`, with `<svg:svg>` namespace canonicalization and optional `customSanitizer`). Direct, presigned-finalize, and resumable uploads run `sniffImageFormat` and `assertImageMetadataLimits`; `createMultipartUploadHandler` defaults to server-generated keys, image-only MIME types, a `100 MB` byte cap, and `validateOnComplete: true`. Rate-limit IP fallback ignores `X-Forwarded-For` unless `trustProxy` is configured. Presigned `finalize` verifies signature/expiry, `authorize`, and `sub` ownership *before* consuming `jti`, and calls `releaseUploadToken` on retryable storage errors.
- **Storage**: Implementations adhere strictly to `StorageAdapter` (`upload` with optional `signal`, `delete`, optional `exists`, `stat`, `getPublicUrl`, `list`, `deleteByUrl`, `parseUrl`, `createPresignedUpload`, `download`, `createPresignedDownload`, `healthCheck`, and multipart hooks). Built-in adapters (including `memoryAdapter`) enforce `sanitizeStorageKey`, `validateStorageMetadata`, and `normalizeStorageError`.

## 4. The 4 UI Styling Tiers & Multi-Platform Parity

1. **Tier 1 (CSS Tokens / Native Theme)**: `--iuk-*` CSS custom properties (React, Vue & Angular) and `defaultNativeTheme` (React Native) with dark mode, RTL support, and `prefers-reduced-motion`.
2. **Tier 2 (Unstyled + Slots)**: `unstyled?: boolean`, per-slot `classNames` & `styles`, `data-slot`, and `data-state="idle|dragging|uploading|ready|error|disabled"`. Hidden file inputs MUST retain `HIDDEN_INPUT_STYLE`.
3. **Tier 3 (Slot Renderers)**: Partial custom renderers (`renderDropzone`, `renderPreview`, `renderHeader`, `renderEmptyDropzone`, `renderTile`, `renderAddMore`).
4. **Tier 4 (Headless Primitives)**: Zero-opinion controllers across React (`img-upload-kit/headless`), Vue (`img-upload-kit/vue`), Angular (`img-upload-kit/angular`), and React Native (`img-upload-kit/react-native`).

## 5. Verification Commands

Before concluding any work, verify all checks pass:
```bash
node scripts/check-max-lines.mjs # Enforces <= 300 lines across every file (npm run check:lines)
npm run typecheck                # Must pass with zero TypeScript errors
npm run lint                     # Must pass with zero ESLint errors (enforces max-lines <= 300)
npm run build                    # Builds dist/ (ESM, CJS, CLI, .d.ts, .d.cts, dist/styles*.css)
npm test                         # Must pass all Vitest suites (Node + jsdom + doc-examples-typecheck)
node scripts/check-dist.mjs      # Verifies 'use client', singletons, dependency graph, and exports
npm pack --dry-run               # Verifies clean publish tarball contents (npm run check:pack)
```
