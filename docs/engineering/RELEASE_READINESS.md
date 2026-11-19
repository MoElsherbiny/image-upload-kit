# `img-upload-kit` — Release Readiness Report

> **Release Gate Status**: **RE-AUDIT REMEDIATION IN PROGRESS / READY FOR FINAL COORDINATOR VERIFICATION (`2.3.0` minor target) — Awaiting maintainer approval before npm publish.**  
> Do **not** publish to npm or bump `package.json` `version` (`2.2.5` on disk; `[Unreleased]` targeted as **`2.3.0`** minor, additive) without explicit maintainer sign-off.

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
- **Phases 8–10, Production Audit (`G-01`–`G-09`) & Independent Re-Audit Remediation (`H-1`–`L-8`)**:
  - Note on earlier readiness snapshot: the initial `main @ e9499c9` report prematurely marked `G-04` (multipart path override/content validation) and `G-09` (CI lockfile reproducibility & dev advisories) closed, and an independent adversarial re-audit identified findings `H-1`–`H-3`, `M-1`–`M-8`, and `L-1`–`L-8` (tracked individually in `docs/engineering/RISK_REGISTER.md` with status *Fixed in re-audit remediation* for post-merge coordinator verification).
  - Re-audit fixes include: server-generated multipart keys + image-only MIME defaults + `100 MB` `maxTotalBytes` + `validateOnComplete: true` (`H-1`, `H-2`, `L-7`), resumable preset-bucket preservation (`H-3`), opt-in `trustProxy` rate-limit IP parsing (`M-1`), isolated abort signals for coalesced dedupe callers (`M-2`) and storage writes (`L-1`), normalized storage errors (`M-3`), retry-safe resumable/presign-finalize failure handling (`M-6`), routed cleanup errors (`L-2`), `memoryAdapter` key sanitization (`L-4`), `<svg:svg>` `xmlns` preservation (`L-5`), accurate CLI custom-storage reporting (`L-6`), isolated `dist/*.d.ts` type-checking for all documentation `ts`/`tsx` snippets (`M-7`), delete-ownership & private-staging security recipes (`M-4`, `M-5`), and Corepack `pnpm install --frozen-lockfile` CI with `0` critical/high `pnpm audit` advisories (`M-8`).

## 2. Outstanding Risks & Honest Limitations

- **Supply-chain & audit status (`R-08` / `M-8`)**: Published consumer `"dependencies": {}` is empty (`0` runtime advisories). Across `pnpm-lock.yaml`, `pnpm audit` reports **`0` critical, `0` high, `3` moderate, `0` low** (all 3 moderate entries are in dev-only `vitest@3.2.7` / `@vitest/mocker@3.2.7`; `tinypool`, `minimatch`, `glob`, and `esbuild` advisories are eliminated via `pnpm.overrides`).
- **Multipart uploads do not run Sharp pixel re-encoding**: `createMultipartUploadHandler` enforces server-generated keys, image-only MIME types, `100 MB` `maxTotalBytes`, and post-complete magic-byte header verification (`validateOnComplete: true` when `storage.download` is supported), but streams parts directly to object storage without Sharp re-encoding or metadata stripping. Use `createImageUploader` (direct, presigned-finalize, or resumable) whenever Sharp AVIF/WebP transcoding, EXIF stripping, or `assertImageMetadataLimits` pixel caps are required.
- **Presigned staging bucket isolation**: Unless `presigned.stagingBucket` points to a dedicated private bucket, `_staging/` uploads temporarily reside in the target bucket until finalized or swept. Always configure a private `stagingBucket`, a 1-day `_staging/` bucket lifecycle rule, and scheduled `sweepStagedUploads`.
- **In-memory stores are single-instance only**: The default presign replay `Map` (capped at 4,096 entries), `createMemoryRateLimiter`, `createMemoryDedupeStore`, and `createMemoryStorageAdapter` are process-local and unsuitable for multi-instance, container, or serverless/edge production deployments. Supply distributed implementations (e.g., Redis/Upstash/KV/SQL).
- **Cloud storage provider tiers**: LocalFS, AWS S3, Supabase Storage, and Memory are official native adapters; Cloudflare R2, MinIO, DigitalOcean Spaces, and Backblaze B2 are verified via `createS3StorageAdapter`; **Google Cloud Storage, Azure Blob Storage, and Firebase Storage require a custom `StorageAdapter`** (blueprint provided in `docs/STORAGE_ADAPTERS.md`).

## 3. Breaking Changes & SemVer Target (`2.3.0`)

- **Target version**: **`2.3.0`** (minor, additive over published `2.2.5`; `package.json` remains `2.2.5` until maintainer cut).
- **Published API compatibility**: **Zero breaking changes** relative to published `2.2.5`. (Tightening `createMultipartUploadHandler` defaults in `H-1`/`H-2` affects only an unreleased endpoint introduced on this `2.3.0` cycle.)
- HTTP error responses retain `{ error: string }` while adding `{ code, retryable, metadata? }`.
- `UploadValidationError` extends `UploadKitError` and preserves existing `400` defaults.
- All existing package subpaths, exports, and CLI blur-manifest commands remain intact.

## 4. Footprint & Maintainability Metrics

| Metric | Verified Value | Guardrail |
| --- | --- | --- |
| Runtime `dependencies` | `0` (`"dependencies": {}`) | Must be empty |
| Repository file line cap | `323`+ files checked — **all `<= 300` lines** | `<= 300` lines (`check-max-lines.mjs` + ESLint) |
| TypeScript `any` violations | `0` | `@typescript-eslint/no-explicit-any: error` |
| Core ESM bundle sizes | `index.js` `1.97 KB`, `client.js` `1.70 KB`, `server-handler.js` `1.03 KB`, `storage.js` `37.41 KB`, `server.js` `103.36 KB` | Zero cross-framework leakage |
| Tarball footprint (`npm pack`) | `149` files, `590.7 kB` packed (`2.7 MB` unpacked) | Zero `.map` files in tarball |
| Optimizer benchmark (`WebP q80`, `1600x1066` JPEG) | `118.4 ms` single / `127.4 ms` x4 parallel (`63.5%` size savings) | Node `v22.23.2`, Sharp `0.35.5` |

## 5. Verification Evidence

All verification gates passed cleanly on the merged `main` branch:

| Command | Result |
| --- | --- |
| `node scripts/check-max-lines.mjs` | Passed (`323`+ files verified, all `<= 300` lines) |
| `npm run typecheck` | Passed (`0` TypeScript errors) |
| `npm run lint` | Passed (`0` ESLint errors + `check-max-lines`) |
| `npm run build` | Passed (ESM, CJS, CLI, DTS, CSS) |
| `npm run check:dist` | Passed (`184` passed, `0` failed) |
| `npm test` | Passed (`50`+ test files, `333`+ tests passed; final merged count verified by coordinator) |
| `pnpm audit` | `0` critical, `0` high, `3` moderate (dev-only `vitest`/`@vitest/mocker`), `0` low |
| `npm pack --dry-run` | Passed (`149` files, `590.7 kB` packed) |
| `node scripts/benchmark-optimizer.mjs` | Passed (8 scenarios measured; recorded in `docs/BENCHMARKS.md`) |

**Final Status**: Ready for maintainer review and approval. **Awaiting maintainer approval before npm publish.**
