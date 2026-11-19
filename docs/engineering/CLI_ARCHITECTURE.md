# CLI Architecture — Phase 7B

`img-upload-kit` ships a zero-runtime-dependency, infrastructure-aware CLI (`dist/bin.js` & `img-upload-kit/cli`) designed to detect a project's frontend, backend runtime, object storage, CDN, auth, and monorepo setup before recommending or scaffolding anything.

## Design Principles

1. **Zero Runtime Dependencies**: Uses Node.js built-ins (`node:fs/promises`, `node:path`, `node:util`, `node:child_process`) plus `src/cli/argv.ts` and `src/cli/tui.ts`. `package.json` `"dependencies": {}` remains empty.
2. **4-Layer Separation**: Frontend, Backend/Runtime, Object Storage, and CDN/Auth/Workspace are detected independently so a React SPA on Vite is never confused with a Next.js Node server, and Cloudflare Workers is never treated as Sharp-compatible.
3. **Strict Secret Safety**: Only allowlisted template files (`.env.example`, `.env.sample`, `.env.template`) are inspected, and **only key names** are extracted. `.env` / `.env.local` secret values are never read, copied, or printed.
4. **Honest Capabilities**: Storage providers without a native adapter (`gcs`, `azure-blob`, `firebase`) are explicitly marked `custom-adapter-required` and scaffolded with a `StorageAdapter` template.
5. **Non-Destructive Filesystem Operations**: `fileManager.ts` previews diffs, flags conflicts, supports `--dry-run`, preserves CRLF/LF line endings, and rolls back modified files on mid-write failure.

## Module Map (`src/cli/`)

| Directory / File | Responsibility |
| --- | --- |
| `types/detection.ts`, `types/architecture.ts` | Strict TypeScript contracts (zero `any`) |
| `capabilities/storageRegistry.ts` | Honest `StorageProviderCapability` metadata for all 13 providers |
| `capabilities/runtimeRegistry.ts` | `RuntimeCapability` & Sharp compatibility matrix |
| `package-managers/pmDetector.ts` | Lockfile, Corepack `packageManager`, monorepo parent & UA detection |
| `detection/envInspector.ts` | Allowlisted env template key-only parser + public-secret leak detector |
| `detection/layerDetectors.ts` | Pure evidence-based extractors for Layers A, B, C, and D |
| `detection/projectDetector.ts` | Orchestrates config/package/env inspection -> `ProjectDetectionReport` |
| `recommendations/architectureResolver.ts` | Pure, terminal-free 4-priority architecture resolver |
| `recommendations/dependencyPlanner.ts` | PM-aware, runtime-safe dependency planner (blocks Sharp in browser/edge) |
| `filesystem/fileManager.ts` | Conflict detection, EOL preservation, `--dry-run`, transactional rollback |
| `filesystem/envManager.ts` | Safe `.env.example`/`.env.sample`/`.env.template` key-only merger |
| `filesystem/agentsManager.ts` | Marker-bounded (`<!-- img-upload-kit:start/end -->`) `AGENTS.md` updater |
| `generators/*` | Storage, framework, env, `AGENTS.md`, and combined scaffold planners |
| `validation/projectValidator.ts` | Unified project integration + optional blur manifest validator |
| `validation/doctorEngine.ts` | Diagnostics (`doctor`) and safe non-destructive auto-fixes (`doctor --fix`) |
| `commands/*`, `commands.ts`, `index.ts` | CLI entrypoints (`init`, `setup`, `doctor`, `validate`, `agents`, `config`, plus blur manifest commands) |

## Command Surface

- `init` / `setup`: Interactive or `--yes` setup with `--dry-run`, `--no-install`, `--scaffold`, `-f`, `-s`, `-p`.
- `doctor` / `doctor --fix`: Audits Sharp runtime compatibility, public env secret leaks, missing deps, missing env keys, and `AGENTS.md` markers.
- `validate`: Validates project integration (+ blur manifest if present); passing `-f`/`--manifest` validates a specific blur manifest file directly.
- `agents` / `agents --update`: Creates or updates root `AGENTS.md` while preserving all user content outside the managed markers.
- `config`: Prints detected and resolved configuration JSON with sensitive env keys marked `redacted: true` and zero secret values read.
- Legacy blur manifest commands (`generate`, `sync`, `cleanup`, `health`, `inspect`) remain 100% backward compatible.
