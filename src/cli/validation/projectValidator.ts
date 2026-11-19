import fs from 'node:fs/promises';
import path from 'node:path';
import { findPublicSecretEnvLeaks } from '../detection/envInspector';
import { detectProject } from '../detection/projectDetector';
import { AGENTS_MARKER_END, AGENTS_MARKER_START } from '../filesystem/agentsManager';
import { buildEnvEntriesForRecommendation } from '../generators/envTemplate';
import { resolveArchitecture } from '../recommendations/architectureResolver';
import { planDependencies } from '../recommendations/dependencyPlanner';
import type { ProjectValidationReport } from '../types/architecture';
import { validateBlurHashFile } from '../validation';

export async function validateProjectIntegration(
  cwd: string = process.cwd(),
): Promise<ProjectValidationReport> {
  const report = await detectProject(cwd);
  const rec = resolveArchitecture(report);
  const deps = planDependencies(report, rec);
  const errors: string[] = [];
  const warnings: string[] = [];
  const checksRun: string[] = [
    'detection',
    'runtime-sharp-compatibility',
    'env-public-secret-leak',
    'env-required-keys',
    'dependencies',
    'agents-md',
  ];

  // 1. Sharp in incompatible runtime
  if (!rec.runtimeCapability.supportsSharp && report.installedPackages.includes('sharp')) {
    errors.push(
      `sharp is installed in ${rec.runtimeCapability.displayName}, which cannot execute Sharp native binaries. Remove sharp from this workspace and offload processing to a Node.js backend.`,
    );
  }

  // 2. Public env secret leaks (key-name inspection only — never reads .env values)
  for (const envFile of report.envFiles) {
    const leaks = findPublicSecretEnvLeaks(envFile.keys);
    for (const leakedKey of leaks) {
      errors.push(
        `Potential secret exposed in public env var "${leakedKey}" (${envFile.fileName}). Move secrets to server-only env vars.`,
      );
    }
  }

  // 3. Required env keys check (against template files)
  const expectedEnvEntries = buildEnvEntriesForRecommendation(rec);
  const allTemplateKeys = new Set(report.envFiles.flatMap((f) => f.keys));
  if (expectedEnvEntries.length > 0 && report.envFiles.length > 0) {
    const missingKeys = expectedEnvEntries
      .map((e) => e.key)
      .filter((k) => !allTemplateKeys.has(k));
    if (missingKeys.length > 0) {
      warnings.push(
        `Missing recommended env template keys: ${missingKeys.join(', ')}. Run "img-upload-kit doctor --fix".`,
      );
    }
  }

  // 4. Dependencies check
  if (deps.toInstall.length > 0) {
    warnings.push(
      `Missing recommended packages: ${deps.toInstall.join(', ')} (${deps.installCommand}).`,
    );
  }

  // 5. Custom adapter honesty note
  if (rec.requiresCustomAdapter) {
    warnings.push(
      `${rec.storageCapability.displayName} requires a custom StorageAdapter implementation (no native adapter built in).`,
    );
  }

  // 6. AGENTS.md managed markers
  if (!report.hasAgentsMd) {
    warnings.push('Root AGENTS.md not found. Run "img-upload-kit agents" to generate one.');
  } else {
    try {
      const agentsRaw = await fs.readFile(path.join(report.cwd, 'AGENTS.md'), 'utf8');
      if (!agentsRaw.includes(AGENTS_MARKER_START) || !agentsRaw.includes(AGENTS_MARKER_END)) {
        warnings.push(
          'AGENTS.md exists without img-upload-kit markers. Run "img-upload-kit agents --update" to safely append the managed section.',
        );
      }
    } catch {
      // Unreadable
    }
  }

  // 7. Optional blur manifest validation if present
  if (report.hasBlurManifest) {
    checksRun.push('blur-manifest');
    const manifestResult = await validateBlurHashFile(
      path.join(report.cwd, 'src/blur-hashes.json'),
    );
    for (const w of manifestResult.warnings) warnings.push(`blur-manifest: ${w}`);
    for (const e of manifestResult.errors) errors.push(`blur-manifest: ${e}`);
  }

  return {
    cwd: report.cwd,
    valid: errors.length === 0,
    errors,
    warnings,
    checksRun,
  };
}
