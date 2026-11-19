# CLI Implementation Plan — Phase 7B (12 Stages)

All 12 stages of the Phase 7B infrastructure-aware CLI are scoped to `src/cli/`, `tests/cli/`, and `docs/engineering/CLI_*.md`, adhering to the repository's `<= 300` lines/file, zero-`any`, and zero-runtime-dependency guardrails.

## Stage Breakdown

1. **Stage 1 — Domain Types (`src/cli/types/`)**: Define `ProjectDetectionReport`, `LayerDetection`, `EvidenceItem`, `StorageProviderCapability`, `RuntimeCapability`, `ArchitectureRecommendation`, `DependencyPlan`, `DoctorReport`, and `ProjectValidationReport`.
2. **Stage 2 — Honest Capability Registries (`src/cli/capabilities/`)**: Implement `storageRegistry.ts` (13 providers) and `runtimeRegistry.ts` (13 runtimes) with explicit Sharp and custom-adapter metadata.
3. **Stage 3 — Package Manager Detector (`src/cli/package-managers/`)**: Detect `pnpm`/`npm`/`yarn`/`bun` via `packageManager` field, lockfiles (including parent monorepo roots), and user-agent fallback.
4. **Stage 4 — 4-Layer Evidence Detection (`src/cli/detection/`)**: Build `envInspector.ts` (key-name only), `layerDetectors.ts` (Layers A–D), and `projectDetector.ts` (config + package + monorepo + Docker signals).
5. **Stage 5 — Pure Architecture Resolver (`src/cli/recommendations/architectureResolver.ts`)**: Enforce reuse-first priority, Sharp offload advisories, security guidance, and ambiguity reporting.
6. **Stage 6 — Runtime-Safe Dependency Planner (`src/cli/recommendations/dependencyPlanner.ts`)**: Skip installed packages and block server-only dependencies in browser, mobile, and edge runtimes.
7. **Stage 7 — Safe Filesystem & Rollback Manager (`src/cli/filesystem/fileManager.ts`)**: Conflict detection, preview summaries, `--dry-run`, EOL preservation (CRLF/LF), and transactional rollback on write error.
8. **Stage 8 — `.env.example` & `AGENTS.md` Managers (`src/cli/filesystem/envManager.ts`, `agentsManager.ts`)**: Reuse existing env template files, reject public-prefix secret leaks, and manage `AGENTS.md` inside `<!-- img-upload-kit:start/end -->` markers.
9. **Stage 9 — Real-Export Code Generators (`src/cli/generators/`)**: Generate storage adapters (native, S3-compatible, custom scaffolds), framework routes/clients, env entries, and `AGENTS.md` blocks using verified `img-upload-kit` exports.
10. **Stage 10 — Validation & Doctor Engines (`src/cli/validation/`)**: Implement `projectValidator.ts` and `doctorEngine.ts` (`--fix` for non-destructive env/AGENTS repairs).
11. **Stage 11 — Command Wiring & Backward Compatibility (`src/cli/commands/`, `commands.ts`, `init.ts`, `index.ts`)**: Wire `init` (`--dry-run`, `--scaffold`), `doctor`, unified `validate`, `agents`, and `config` while preserving all existing blur-manifest commands and exports.
12. **Stage 12 — 19-Topology Fixture Test Suite & Engineering Docs (`tests/cli/`, `docs/engineering/`)**: Verify all 19 topologies, safety invariants, Windows paths, and build/dist checks.
