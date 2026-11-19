# `img-upload-kit` — Phase 0 Architecture Review

> Evidence-based audit of `src/` modules, security boundaries, performance characteristics, and documentation consistency as of `v2.2.5`.

## 1. High-Level Module Map

- **`src/types/` & `src/utils/`**: Pure, dependency-free domain types (`presets`, `aspectRatio`, `quality`, `upload`), validators, color math, and formatters. Clean separation.
- **`src/core/` & `src/i18n/`**: Shared framework-agnostic placeholder builders, `attachPointerReorder`, upload pipeline helpers, and `en`/`ar` translations.
- **`src/client/`**: Universal XHR/Fetch upload engine (`xhrUpload`, `presignedUpload`, `uploadAsset`, `uploadQueue`, `uploadTracker`, `resize`, `transform`, `deleteRequest`). Works across Web and React Native.
- **`src/server/`**:
  - `handler/`: Web Standard `Request -> Response` handler (`POST` direct, `?action=presign`, `?action=finalize`, `DELETE`). Edge-safe subpath `./server/handler` verified free of `sharp` and `node:fs`.
  - `security/`: `sniffFormat.ts` (magic-byte sniffing) and `sanitizeSvg.ts`.
  - `optimization/`: Sharp AVIF/WebP pipeline, aspect-ratio attention crop, single-decode LQIP/BlurHash/4-edge color extraction.
  - `uploader/`: `createImageUploader`, content-hash deduplication (`dedupe.ts`), collision retries, responsive variant generation, and `AsyncSemaphore` concurrency throttling.
- **`src/storage/`**: `StorageAdapter` contract + `localFsAdapter`, `s3Adapter`, `supabaseAdapter`, `memoryAdapter`.
- **`src/react/`, `src/vue/`, `src/angular/`, `src/react-native/`**: Four-tier styling and headless parity.
- **`src/cli/`**: Zero-dep CLI (`argv.ts`, `tui.ts`, `detect.ts`, `init.ts`, `commands.ts`, `scanner.ts`, `generator.ts`, `validation.ts`).

## 2. Concrete Architectural & Security Findings

### Finding A — Presign Token Lifecycle & Ownership (`src/server/handler/uploadToken.ts`, `presignRoute.ts`, `finalizeRoute.ts`)
- **Evidence**:
  1. `PresignTokenPayload.sub` is declared (`uploadToken.ts:17`) but **never set** in `presignRoute.ts:242-254` and **never verified** in `finalizeRoute.ts:54-75`.
  2. `finalizeRoute.ts:54` calls `verifyUploadToken(..., { consume: true })` **before** `runAuthorize(authorize, authCtx)` at line 73. An unauthorized caller with a leaked token can burn the token before auth runs, and cross-user token replay is not blocked at the token layer.
  3. No secret rotation (`string | readonly string[]`) and no configurable `clockToleranceMs`.
- **Impact**: High — Weak ownership binding and operational fragility during secret rotation.

### Finding B — SVG Sanitizer Is Regex Denylist, Not Allowlist (`src/server/security/sanitizeSvg.ts`)
- **Evidence**: `AGENTS.md` and `CHANGELOG.md` describe `sanitizeSvg` as an "allowlist SVG sanitizer", but `sanitizeSvg.ts:5-25` uses a regex `FORBIDDEN_ELEMENTS` denylist with 4 passes.
- **Impact**: High — Denylist regex sanitizers are vulnerable to unknown/SVG2/MathML/HTML tags, malformed unclosed tags, and attribute/namespace edge cases when `allowSvg: true` is enabled.

### Finding C — Raw JPEG Passthrough Leaks EXIF Metadata (`src/server/optimization/imageOptimizer.ts`)
- **Evidence**: Lines `208-215` return the untouched input `buffer` when JPEG re-encoding is larger than the original and `orientation <= 1`.
- **Impact**: Medium — GPS coordinates, device serials, and EXIF/IPTC metadata remain in published images.

### Finding D — Missing Pre-Decode Dimension & Frame Guards (`src/server/optimization/imageOptimizer.ts`)
- **Evidence**: `limitInputPixels` is enforced, but there are no independent `maxWidth`, `maxHeight`, or `maxFrames` (animated GIF/WebP) limits before Sharp processes the buffer.
- **Impact**: Medium — Crafted high-frame animated images or extreme aspect ratios can consume excessive CPU/memory.

### Finding E — Storage Adapter Traversal & Capability Gaps (`src/storage/`)
- **Evidence**:
  - `s3Adapter.ts:24-28` (`normalizeS3Key`) strips leading slashes but does **not** reject `..` or `\0` segments.
  - `supabaseAdapter.ts` passes `params.path` directly without traversal validation.
  - `localFsAdapter.ts` checks lexical `path.relative` containment but does not verify symlink targets (`fs.realpath`).
  - No `createPresignedDownload`, `healthCheck`, multipart upload hooks, or storage migration utility.
- **Impact**: Medium — Defense-in-depth gaps and missing production storage primitives.

### Finding F — Unstructured Errors & Missing Rate-Limit/Quota Hooks (`src/server/handler/responses.ts`, `src/client/xhrUpload.ts`)
- **Evidence**: Errors serialize only `{ error: string }` without stable `code` or `retryable` flags. `UploadHttpHandlerOptions` has no `rateLimiter` or `quotaProvider` hooks.
- **Impact**: Medium — Difficult for clients to distinguish retryable transient failures from terminal validation/auth errors.

### Finding G — CLI Infrastructure & Runtime Blindness (`src/cli/detect.ts`, `src/cli/init.ts`)
- **Evidence**:
  - `detect.ts:182` blindly adds `sharp` whenever `framework !== 'react-native' && framework !== 'client'`, even for frontend-only Vite React apps or Cloudflare Workers/Edge runtimes where `sharp` cannot run.
  - Only detects basic framework + PM; no detection of backend runtime, existing storage SDKs/env keys, CDN, auth, or monorepos.
  - Does not generate `.env.example`, `AGENTS.md`, or framework-specific integration files; lacks `doctor`, `agents`, and `config` commands.
- **Impact**: High (DX) — Causes broken installs on frontend-only/edge projects and forces manual setup.

## 3. Documentation & Consistency Gaps
- `AGENTS.md` describes `sanitizeSvg` as an allowlist sanitizer (inaccurate until Phase 1).
- No dedicated `docs/SECURITY_GUIDE.md`, `docs/STORAGE_ADAPTERS.md`, `docs/ERROR_HANDLING.md`, or `docs/BENCHMARKS.md`.
- CLI `validate` currently validates blur manifests (`src/blur-hashes.json`); Phase 7B must preserve this behavior while adding project validation.
