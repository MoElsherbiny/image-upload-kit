# `img-upload-kit` — Technical Roadmap (Phases 0–10)

> Grounded in `BASELINE.md` and `ARCHITECTURE_REVIEW.md`. Every file across the repo must stay `<= 300` lines, with zero `any` and zero runtime dependencies (`"dependencies": {}`).

## Phase Sequence & Priorities

| Phase | Focus | Primary Deliverables | Exit Gate |
| --- | --- | --- | --- |
| **Phase 0** | Discovery & Baseline | `BASELINE.md`, `ARCHITECTURE_REVIEW.md`, `TECHNICAL_ROADMAP.md`, `RISK_REGISTER.md`, `IMPLEMENTATION_PROGRESS.md` | Baseline green (`220` tests, `184` dist checks) |
| **Phase 1** | Security Engineering | Auth subject binding (`sub`), authorize-before-consume, token rotation + `clockToleranceMs`, zero-dep XML/SVG allowlist sanitizer, `maxWidth`/`maxHeight`/`maxFrames` guards, storage traversal/symlink hardening | Adversarial security test suite passing |
| **Phase 2** | Production Reliability | `UploadKitError` + stable error codes, standardized lifecycle/cancellation across client & frameworks, `RateLimiter` & `QuotaProvider` interfaces + dev memory limiter, explicit safe orphan/session cleanup | Reliability & error-contract tests passing |
| **Phase 3** | Advanced Uploads | Resumable chunked uploads (`resumableUpload.ts` + `resumableRoute.ts`), S3-compatible multipart hooks, exponential backoff + jitter retry with idempotency | Resumable, multipart & retry tests passing |
| **Phase 4** | Image Optimization | Strip EXIF on all outputs (fix JPEG passthrough leak), ICC/sRGB control, focal-point crop, `Accept` format negotiation, pluggable `TransformCache`, `medium`/`large` presets, reproducible benchmark script | Real benchmark report in `docs/BENCHMARKS.md` |
| **Phase 5** | Storage Architecture | `createPresignedDownload`, `healthCheck`, error normalization, resumable dry-run `migrateStorage()` with SHA-256 verification, provider limitation docs | Storage & migration tests passing |
| **Phase 6** | Framework Integrations | Align lifecycle/error/cancel parity across React, Vue/Nuxt, Angular, React Native/Expo; live HTTP integration tests for Express, Fastify, Hono | All framework & server integration tests passing |
| **Phase 7A** | DX & Documentation | Public type audit, `SECURITY_GUIDE.md`, `STORAGE_ADAPTERS.md`, `ERROR_HANDLING.md`, compile-checked README examples | Docs match real API; all checks green |
| **Phase 7B** | Backend-Agnostic CLI (12 Stages) | 4-layer detector, capability registry, architecture resolver, safe file/`.env.example`/`AGENTS.md` managers, framework generators, `init`/`doctor`/`validate`/`agents`/`config`, 19-fixture test matrix | All 19 fixture tests + `dist/bin.js` smoke green |
| **Phase 8** | QA & Distribution | Adversarial, reliability, ESM/CJS/DTS consumer tests, tarball & CI Node 20/22/24 verification | Full CI & distribution suite green |
| **Phase 9** | Perf & Maintainability | Bundle/footprint/memory audit, cold-start & build time check, `<= 300` lines verified | No regressions; modular boundaries verified |
| **Phase 10** | Release Readiness | Semver/changelog/metadata/policy audit, `docs/engineering/RELEASE_READINESS.md` | Zero Critical/High blockers; await maintainer approval |

## Backward-Compatibility Commitments

1. Keep all 12 JS/TS subpaths and 7 CSS exports intact.
2. Keep `{ error: string }` in HTTP error JSON responses while adding additive `{ code, retryable }`.
3. Keep `img-upload-kit validate -f <manifest>` working while extending `validate` for project integration checks.
4. Keep `"dependencies": {}` empty and `sharp` / framework packages optional peers.
5. Never auto-publish to npm or alter release credentials.
