# `img-upload-kit` — Phase 0 Engineering Baseline

> Captured on **2026-11-19** against `img-upload-kit@2.2.5` (Node `v22.23.2`, pnpm `9.15.0`, npm `10.9.8`, Windows).
> No implementation code was modified prior to capturing this baseline.

## 1. Automated Verification Baseline

| Check | Command | Result | Key Metrics |
| --- | --- | --- | --- |
| Max-Lines Guardrail | `node scripts/check-max-lines.mjs` | **PASS** | 245 files verified (all `<= 300` lines, including `.md`) |
| TypeScript Typecheck | `npm run typecheck` | **PASS** | 0 errors (`strict: true`, `noEmit: true`) |
| ESLint + Line Cap | `npm run lint` | **PASS** | 0 errors, 0 warnings (`no-explicit-any: error`) |
| Package Build | `npm run build` | **PASS** | Dual ESM/CJS + `.d.ts`/`.d.cts` + CSS layers + `dist/bin.js` |
| Dist Integrity | `npm run check:dist` | **PASS** | **184 passed, 0 failed** |
| Test Suite | `npm test` | **PASS** | **31 files, 220 tests passed** (Node + jsdom, `5.46s`) |
| Tarball Dry-Run | `npm pack --dry-run` | **PASS** | **139 files**, `470.0 kB` packed, `2.2 MB` unpacked |
| Dependency Audit | `pnpm audit` | **WARN (dev only)** | **0 runtime deps**; 8 devDependency advisories (2 critical, 5 moderate, 1 low) |

## 2. Package Exports & Footprint

- **Runtime dependencies**: `{}` (zero runtime dependencies; `blurhash` is vendored into `src/blur/vendor/blurhash`).
- **Optional peer dependencies**: `sharp` (`^0.34.5 || ^0.35.0`), `react` (`>=18`), `react-dom` (`>=18`), `vue` (`>=3.5`), `@angular/core` (`>=17.3`), `react-native` (`>=0.74`).
- **Node.js engine**: `>=20.0.0` (CI matrix: Node `20`, `22`, `24`).
- **CLI binary**: `img-upload-kit` → `dist/bin.js` (`182 B` wrapper importing `./cli.js`).

### Built Entry Sizes (ESM / CJS)

| Subpath Export | ESM (`dist/*.js`) | CJS (`dist/*.cjs`) | Notes |
| --- | --- | --- | --- |
| `.` (`index`) | `1.81 KB` | `2.82 KB` | Universal types, presets, validators, blur helpers |
| `./client` | `1.18 KB` | `1.92 KB` | Universal XHR/Fetch, resize, presigned engine |
| `./server` | `75.48 KB` | `83.11 KB` | Sharp optimizer, uploader, security, handler |
| `./server/handler` | `539 B` | `810 B` | Edge-safe handler entry (zero `sharp`/`fs` graph) |
| `./storage` | `21.98 KB` | `25.12 KB` | LocalFS, S3/R2, Supabase, Memory adapters |
| `./blur` | `951 B` | `1.50 KB` | `BlurService`, LRU cache, BlurHash decoder |
| `./react` | `134.75 KB` | `157.57 KB` | `'use client'`, shared context singleton |
| `./headless` | `670 B` | `1021 B` | `'use client'`, headless hooks/render-props |
| `./vue` | `59.80 KB` | `70.42 KB` | Vue 3.5+ plugin, composables, components |
| `./angular` | `51.38 KB` | `59.47 KB` | Signal controllers, Zoneless bridge, DOM mounts |
| `./react-native` | `59.72 KB` | `67.50 KB` | Expo/RN components, hooks, picker adapters |
| `./cli` | `72.79 KB` | `76.84 KB` | Interactive setup + blur manifest CLI |
| `./styles.css` | `39.9 KB` | — | Combined CSS + 6 modular `dist/styles/*.css` layers |

## 3. Dependency Audit Breakdown (Dev-Only)

Runtime consumers install **zero** third-party packages. Dev-only advisories reported by `pnpm audit`:

- **Critical (2)**: `tinypool` (via `vitest@3.2.7`) and transitive dev tooling.
- **Moderate (5)**: `minimatch@10.2.6` (via `typescript-eslint`, `@vue/test-utils`).
- **Low (1)**: `esbuild@0.27.7` (via `tsup@8.5.1`, Windows dev-server only).

> Action: Track dev-dependency upgrades in Phase 8/10 without introducing breaking toolchain regressions during core security hardening.

## 4. Test Coverage Snapshot

- **Node project (23 files)**: Core utils, client engine, storage adapters, presigned uploads, security basics, server uploader/raster/variants/aspect-crop/dedupe, blur service, CLI init/generator/validation, SSR Vue, dist smoke, adversarial M2 tests.
- **DOM/jsdom project (8 files)**: React interactive/a11y/styling/animated-image/ecommerce-social, Vue components, Angular controllers/DOM, React Native stub tests.
- **Identified Gaps**:
  - No adversarial SVG tokenizer/namespace/malformed-XML test matrix.
  - No distributed/concurrent token replay race or secret-rotation tests.
  - No Express/Fastify/Hono live HTTP integration tests.
  - No resumable/multipart upload, rate-limiting, quota, or storage migration suites.
  - No multi-stack CLI fixture test matrix (19 target project topologies).
