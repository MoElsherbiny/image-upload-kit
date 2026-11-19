# Contributing to `img-upload-kit`

Thank you for contributing to `img-upload-kit`! To keep the package modular, framework-agnostic, and easy to audit, all contributions follow strict architectural guardrails.

## Architectural Principles

### 1. Strict `<= 300` Lines Per File

Every file in this repository — including TypeScript source files, UI components, CSS stylesheets, tests, CLI modules, scripts, and Markdown documentation — **must not exceed 300 lines** (aim for 60–240 lines).

- Enforced automatically via ESLint (`max-lines` rule with `skipBlankLines: false` and `skipComments: false`) and `node scripts/check-max-lines.mjs` (`npm run check:lines`).
- Never use `any` (`@typescript-eslint/no-explicit-any` is `'error'`), and keep `package.json` `"dependencies": {}` empty.
- When a module grows past ~220 lines, split it along clean responsibility boundaries before adding new features.

### 2. Separation of Concerns Across Subpaths

Each module (`src/types`, `src/core`, `src/i18n`, `src/utils`, `src/client`, `src/storage`, `src/blur`, `src/server`, `src/cli`, `src/react`, `src/vue`, `src/angular`, `src/react-native`) maintains strict layer boundaries:

- **Contracts & Pure Utilities**: `src/types`, `src/i18n`, and `src/utils` remain pure, side-effect-free, and zero-dependency.
- **Shared Client & Core Primitives**: `src/core` and `src/client` provide universal upload, validation, resize, presigned, resumable, multipart, and gallery reorder primitives without framework lock-in.
- **Server & CLI Isolation**: `src/server` and `src/cli` may use Node built-ins and lazy `sharp`, and must never be imported by browser or React Native modules. `img-upload-kit/server/handler` stays Edge-safe with zero Sharp imports at module load time.
- **Multi-Platform UI Independence**:
  - `src/react` and `src/react/styles/*.css` never import `next/*` directly (integrations plug in via `as` / `renderImage`).
  - `src/vue` uses optional peer `vue` (`>= 3.5.0`); `src/angular` controllers do not require `@angular/core` at runtime; `src/react-native` never touches DOM globals (`window`, `document`, `HTMLImageElement`).

### 3. Project-Agnostic Presets & Storage

- **No Domain Coupling**: Never hardcode application-specific category names (e.g., `homepage`, `brochure`, `admin-profile`) or vendor-locked bucket names.
- **Universal Visual Roles**: Built-in presets in `STANDARD_PRESETS` represent universal UI roles only (`thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`, `square`, `portrait`, `story`).
- **Consumer Extensibility**: Applications define custom presets with `defineUploadPresets(...)` and optional global TypeScript autocomplete via `UploadKitRegister` module augmentation.
- **Pluggable Storage**: All persistence goes through the `StorageAdapter` contract (`upload`, `delete`, optional `exists`, `stat`, `getPublicUrl`, `list`, `deleteByUrl`, `parseUrl`, `createPresignedUpload`, `download`, `createPresignedDownload`, `healthCheck`, and multipart hooks) with `sanitizeStorageKey`, `validateStorageMetadata`, and `normalizeStorageError`.

## Local Development Workflow

### Prerequisites

- **Node.js** `>= 20.0.0` (tested in CI on Ubuntu Node `20`, `22`, `24` and Windows Node `22`)
- **pnpm** via Corepack (`packageManager: "pnpm@9.15.0"`)

### Setup & Verification Commands

```bash
# 1. Enable Corepack and install locked dependencies
corepack enable && pnpm install --frozen-lockfile

# 2. Enforce <= 300 lines, TypeScript strictness, and ESLint
node scripts/check-max-lines.mjs
npm run typecheck
npm run lint

# 3. Build ESM, CJS, CLI, .d.ts/.d.cts, and CSS bundles
npm run build

# 4. Run the full Vitest suite (Node + jsdom) and bundle/tarball checks
npm test
npm run check:dist
npm pack --dry-run
```

## Canonical `tests/` Pyramid

All test suites live under `tests/` and follow Vitest's dual-project environment convention (`vitest.config.ts`):

- **Environment Convention**: Files named `*.dom.test.{ts,tsx}` run in `jsdom` (with `tests/setup-dom.ts`); all other `*.test.{ts,tsx}` files run in `node`.
- **`tests/unit/`**: Fast isolated unit tests for `core`, `client`, `storage`, and `server` modules.
- **`tests/frameworks/`**: Component, composable, signal, hook, and SSR suites for `react`, `headless`, `vue`, `angular`, and `react-native`.
- **`tests/cli/`**: 4-layer project detection, architecture recommendations, scaffold compilation, `doctor`/`validate`/`agents`/`config`, and blur manifest commands.
- **`tests/security/`**: Adversarial SVG XML corpus, presigned token lifecycle, magic-byte/pixel limits, rate limiting, and route hardening.
- **`tests/integration/`**: Cross-framework parity, Node server adapters, presigned, resumable, and multipart pipelines.
- **`tests/e2e/`**: Full-stack live `node:http` + Sharp + `LocalFsStorageAdapter` uploads across frameworks and end-to-end CLI lifecycles.
- **`tests/packaging/`**: Built `dist/` smoke checks, `npm pack` tarball hygiene, and isolated TypeScript type-checking of every `ts`/`tsx` snippet in `README.md` and `docs/*.md` (`doc-examples-typecheck.test.ts`).
- **`tests/helpers/`**: Shared deterministic Sharp image fixtures, XHR/React Native stubs, and live test server utilities.

## Pull Request Checklist

- [ ] `node scripts/check-max-lines.mjs`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, and `npm run check:dist` pass with zero errors.
- [ ] Public API additions include strict TypeScript types, unit/integration tests, and verified documentation examples (`npx vitest run tests/packaging/doc-examples-typecheck.test.ts`).
- [ ] `CHANGELOG.md` and relevant guides (`README.md` or `docs/*.md`) are updated without adding internal planning files to the repository.
