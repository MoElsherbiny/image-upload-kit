# `img-upload-kit` — Release Readiness Report

> **Release Gate Status**: **READY FOR MAINTAINER REVIEW — Awaiting maintainer approval before npm publish.**  
> Do **not** publish to npm or bump `package.json` version without explicit maintainer sign-off.

## 1. Completed Improvements Across Phases 0–10 & CLI Stages 1–12

- **Phases 1–2 (Security & Reliability)**:
  - Upload token hardening (`src/server/handler/uploadToken.ts`, `presignRoute.ts`, `finalizeRoute.ts`, `options.ts`): `getSubject` ownership binding (`sub`), verify-before-consume ordering (prevents unauthorized single-use token burning), constant-time secret rotation (`string | readonly string[]`), and `clockToleranceMs`.
  - Zero-dependency XML tokenizer & strict SVG allowlist (`svgTokenizer.ts`, `svgAllowlist.ts`, `sanitizeSvg.ts`) with optional `customSanitizer` hook (`allowSvg: false` by default).
  - Pre-decode image resource limits (`imageLimits.ts`: `maxWidth`, `maxHeight`, `maxPixels`, `maxFrames`) and magic-byte header hardening (`sniffFormat.ts`).
  - Structured `UploadKitError` (`src/types/errors.ts`, 12 `UploadErrorCode` values), `toPublicJSON()` error redaction, automatic `Retry-After` headers, `RateLimiter` / `QuotaProvider` interfaces (`src/types/rateLimit.ts`), and dev `createMemoryRateLimiter`.
- **Phases 2B–3 (Reliability & Advanced Uploads)**:
  - Client structured error parsing (`src/client/errors.ts`), exponential backoff + jitter retry (`src/client/retry.ts`), chunked resumable uploads (`resumableUpload.ts`, `resumableRoute.ts`), S3-compatible multipart uploads (`multipartUpload.ts`, `multipartRoute.ts`), and explicit safe cleanup (`src/server/uploader/cleanup.ts`).
- **Phases 4–5 (Optimization & Storage Architecture)**:
  - Fixed JPEG passthrough EXIF metadata leak (`preserveMetadata: false` by default), added normalized `focalPoint` cropping, `colorSpace` (`srgb` / `preserve`), `formatNegotiator.ts`, `transformCache.ts`, and `scripts/benchmark-optimizer.mjs`.
  - Hardened S3, Supabase, and LocalFS adapters (`sanitizeStorageKey`, `validateStorageMetadata`, `localFsAdapter` `fs.realpath` symlink containment), normalized errors (`normalizeStorageError`), added `healthCheck`, `createPresignedDownload`, S3 multipart hooks, and resumable `migrateStorage` (dry-run, cursor pagination, SHA-256 verification, guarded `confirmDestructive`).
- **Phase 6 (Multi-Platform Parity)**:
  - Verified React, Headless, Vue 3 / Nuxt 4, Angular 17–21+, and React Native / Expo entry points with strict zero cross-framework import leakage.
- **Phase 7A (Developer Documentation)**:
  - Added `docs/SECURITY_GUIDE.md`, `docs/STORAGE_ADAPTERS.md`, `docs/ERROR_HANDLING.md`, `docs/BENCHMARKS.md`, and updated `AGENTS.md`.
- **Phase 7B (Backend-Agnostic CLI — All 12 Stages)**:
  - 4-layer infra detection (`detection/`), honest runtime & storage capability registries (`capabilities/`), pure `architectureResolver`, runtime-safe `dependencyPlanner`, safe file/env/`AGENTS.md` managers (`--dry-run`, rollback), `init`/`doctor`/`validate`/`agents`/`config` commands, 19-topology fixture tests, and `docs/engineering/CLI_*.md`.
- **Phases 8–10 (QA, Performance, Release Readiness)**:
  - Expanded automated coverage from `220` to `292` passing tests across `44` test suites (including live Node HTTP server integration, cross-framework parity, dual ESM/CJS/CLI distribution verification, adversarial security, and reliability suites); closed `R-01` through `R-07` in `docs/engineering/RISK_REGISTER.md`.

## 2. Outstanding Risks & Honest Limitations

- **Dev-only audit advisories (`R-08`, Low)**: `pnpm audit` reports advisories solely in build/test `devDependencies` (`tinypool`, `minimatch`, `esbuild`). Published consumer `"dependencies": {}` has **0** runtime advisories.
- **In-memory stores are single-instance only**: The default presign replay `Map` (capped at 4,096 entries), `createMemoryRateLimiter`, `createMemoryDedupeStore`, and `createMemoryStorageAdapter` are process-local and unsuitable for multi-instance, container, or serverless/edge production deployments. Supply distributed implementations (e.g., Redis/Upstash/KV/SQL).
- **Cloud storage provider tiers**: LocalFS, AWS S3, Supabase Storage, and Memory are official native adapters; Cloudflare R2, MinIO, DigitalOcean Spaces, and Backblaze B2 are verified via `createS3StorageAdapter`; **Google Cloud Storage, Azure Blob Storage, and Firebase Storage require a custom `StorageAdapter`** (blueprint provided in `docs/STORAGE_ADAPTERS.md`).

## 3. Breaking Changes

**None.** All changes are 100% additive and backward-compatible:
- HTTP error responses retain `{ error: string }` while adding `{ code, retryable, metadata? }`.
- `UploadValidationError` extends `UploadKitError` and preserves existing `400` defaults.
- All existing package subpaths, exports, and CLI blur-manifest commands remain intact.

## 4. Footprint & Maintainability Metrics

| Metric | Verified Value | Guardrail |
| --- | --- | --- |
| Runtime `dependencies` | `0` (`"dependencies": {}`) | Must be empty |
| Repository file line cap | `316` files checked — **all `<= 300` lines** | `<= 300` lines (`check-max-lines.mjs` + ESLint) |
| TypeScript `any` violations | `0` | `@typescript-eslint/no-explicit-any: error` |
| Core ESM bundle sizes | `index.js` `1.97 KB`, `client.js` `1.65 KB`, `server-handler.js` `927 B`, `storage.js` `37.41 KB`, `server.js` `99.89 KB` | Zero cross-framework leakage |
| Tarball footprint (`npm pack`) | `147` files, `577.5 kB` packed (`2.7 MB` unpacked) | Zero `.map` files in tarball |
| Optimizer benchmark (`WebP q80`, `1600x1066` JPEG) | `118.4 ms` single / `127.4 ms` x4 parallel (`63.5%` size savings) | Node `v22.23.2`, Sharp `0.35.5` |

## 5. Verification Evidence

All verification gates passed cleanly on the merged `main` branch:

| Command | Result |
| --- | --- |
| `node scripts/check-max-lines.mjs` | Passed (`316` files verified, all `<= 300` lines) |
| `npm run typecheck` | Passed (`0` TypeScript errors) |
| `npm run lint` | Passed (`0` ESLint errors + `check-max-lines`) |
| `npm run build` | Passed (ESM `516ms`, CJS `519ms`, CLI `95ms`, DTS `2.14s`, CSS) |
| `npm run check:dist` | Passed (`184` passed, `0` failed) |
| `npm test` | Passed (`44` test files, `292` tests passed in `7.47s`) |
| `npm pack --dry-run` | Passed (`147` files, `577.5 kB` packed) |
| `node scripts/benchmark-optimizer.mjs` | Passed (8 scenarios measured; recorded in `docs/BENCHMARKS.md`) |

**Final Status**: Ready for maintainer review and approval. **Awaiting maintainer approval before npm publish.**
