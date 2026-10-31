# Contributing to `image-upload-kit`

Thank you for contributing to `image-upload-kit`! To keep the package modular, framework-agnostic, and easy to audit, all contributions follow strict architectural guardrails.

## Architectural Principles

### 1. Strict `<= 300` Lines Per File

Every file in this repository — including TypeScript source files, React components, CSS stylesheets, unit tests, CLI scripts, configs, and Markdown documentation — **must not exceed 300 lines** (aim for 60–240 lines).

- Enforced automatically via ESLint (`max-lines` rule with `skipBlankLines: false` and `skipComments: false`) and `npm run check:lines`.
- When a module grows past ~220 lines, split it along clean responsibility boundaries before adding new features.

### 2. Separation of Concerns

Each subpath module (`src/types`, `src/utils`, `src/storage`, `src/blur`, `src/server`, `src/react`, `src/cli`) maintains strict layer boundaries:

- **Contracts & Types**: Keep interfaces and type aliases in dedicated `types.ts` files.
- **Pure Utilities**: Color math, byte formatting, path normalization, and file validation must remain pure and side-effect-free.
- **Server Isolation**: `src/server` and `src/cli` may use Node built-ins and `sharp`, and must never be imported by `src/react`.
- **Pure React UI**: `src/react` and `src/react/styles/*.css` must never import framework-coupled packages (such as `next/*`) or server-only modules. Framework integrations (like `next/image`) plug in through props such as `renderImage` on `<ImageUploadProvider>` or `<BlurImage>`.

### 3. Project-Agnostic Presets & Storage

- **No Domain Coupling**: Never hardcode application-specific category names (e.g., `homepage`, `brochure`, `partners`) or vendor-locked bucket names.
- **Universal Visual Roles**: Built-in presets in `STANDARD_PRESETS` represent universal UI roles only (`thumbnail`, `avatar`, `card`, `cover`, `hero`, `logo`, `original`).
- **Consumer Extensibility**: Applications define custom presets with `defineUploadPresets(...)` and optional global TypeScript autocomplete via `UploadKitRegister` module augmentation.
- **Pluggable Storage**: All persistence goes through the `StorageAdapter` interface (`upload`, `delete`, optional `getPublicUrl`, `list`, `deleteByUrl`) and optional `onUploadRecord` hooks.

## Local Development Workflow

### Prerequisites

- **Node.js** `>= 18.17.0` (tested in CI across Node 18, 20, and 22)
- `npm` or `pnpm`

### Setup & Verification Commands

```bash
# 1. Install dependencies
npm install

# 2. Run strict TypeScript typechecking
npm run typecheck

# 3. Run ESLint flat-config checks
npm run lint

# 4. Run the Vitest unit test suite
npm test

# 5. Build ESM, CJS, .d.ts, and dist/styles.css bundles
npm run build
```

## Testing Guidelines

- Place unit tests under `tests/*.test.ts` mirroring the module under test (e.g., `tests/storage.test.ts`, `tests/server.test.ts`, `tests/blur.test.ts`).
- Use `createMemoryStorageAdapter()` or `createLocalFsStorageAdapter()` against temporary directories so tests run deterministically offline without external cloud credentials.
- Keep individual test files focused and `<= 300` lines.

## Pull Request Checklist

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass cleanly.
- [ ] Public API additions include strict TypeScript types and unit test coverage.
- [ ] `CHANGELOG.md` and relevant documentation (`README.md` or `docs/`) are updated.
