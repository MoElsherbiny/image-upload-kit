import fs from 'node:fs/promises';
import path from 'node:path';
import { findPublicSecretEnvLeaks } from '../detection/envInspector';
import { detectProject } from '../detection/projectDetector';
import {
  AGENTS_MARKER_END,
  AGENTS_MARKER_START,
  planAgentsMdUpdate,
} from '../filesystem/agentsManager';
import { planEnvTemplateMerge } from '../filesystem/envManager';
import { applyFileWrites } from '../filesystem/fileManager';
import { buildAgentsManagedSection } from '../generators/agentsTemplate';
import { buildEnvEntriesForRecommendation } from '../generators/envTemplate';
import { resolveArchitecture } from '../recommendations/architectureResolver';
import { planDependencies } from '../recommendations/dependencyPlanner';
import type { DiagnosticIssue, DoctorReport, PlannedFile } from '../types/architecture';

export interface RunDoctorOptions {
  cwd?: string;
  fix?: boolean;
  dryRun?: boolean;
}

export async function runDoctor(
  options: RunDoctorOptions = {},
): Promise<DoctorReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const report = await detectProject(cwd);
  const rec = resolveArchitecture(report);
  const deps = planDependencies(report, rec);
  const issues: DiagnosticIssue[] = [];
  const fixFiles: PlannedFile[] = [];
  const appliedFixes: string[] = [];

  // 1. Sharp in incompatible runtime
  if (!rec.runtimeCapability.supportsSharp && report.installedPackages.includes('sharp')) {
    issues.push({
      code: 'SHARP_INCOMPATIBLE_RUNTIME',
      severity: 'error',
      message: `sharp is installed in ${rec.runtimeCapability.displayName}, where native Sharp binaries cannot run.`,
      file: 'package.json',
      fixable: false,
      suggestion: 'Remove sharp from this workspace and use an external Node.js processing backend.',
    });
  }

  // 2. Public env secret leaks
  for (const envFile of report.envFiles) {
    for (const leakedKey of findPublicSecretEnvLeaks(envFile.keys)) {
      issues.push({
        code: 'PUBLIC_ENV_SECRET_LEAK',
        severity: 'error',
        message: `Secret-like variable "${leakedKey}" uses a public browser prefix in ${envFile.fileName}.`,
        file: envFile.fileName,
        fixable: false,
        suggestion: `Rename "${leakedKey}" to a server-only env var without NEXT_PUBLIC_/VITE_/EXPO_PUBLIC_.`,
      });
    }
  }

  // 3. Missing dependencies
  if (deps.toInstall.length > 0) {
    issues.push({
      code: 'MISSING_DEPENDENCIES',
      severity: 'warning',
      message: `Missing recommended dependencies: ${deps.toInstall.join(', ')}.`,
      file: 'package.json',
      fixable: false,
      suggestion: deps.installCommand,
    });
  }

  // 4. Missing env template keys
  const envEntries = buildEnvEntriesForRecommendation(rec);
  if (envEntries.length > 0) {
    const envMerge = await planEnvTemplateMerge(cwd, envEntries);
    if (envMerge.addedKeys.length > 0) {
      issues.push({
        code: 'MISSING_ENV_KEYS',
        severity: 'warning',
        message: `Missing env template keys in ${envMerge.targetFileName}: ${envMerge.addedKeys.join(', ')}.`,
        file: envMerge.targetFileName,
        fixable: true,
        suggestion: 'Run "img-upload-kit doctor --fix" to merge missing keys safely.',
      });
      if (options.fix) {
        fixFiles.push({
          relativePath: envMerge.targetFileName,
          content: envMerge.mergedContent,
          description: `Merge missing keys into ${envMerge.targetFileName}`,
          mode: 'merge',
        });
      }
    }
  }

  // 5. Missing or outdated AGENTS.md managed section
  const managedBody = buildAgentsManagedSection(report, rec, deps);
  const agentsPlan = await planAgentsMdUpdate(cwd, managedBody);
  let agentsIssue = false;
  if (!report.hasAgentsMd) {
    agentsIssue = true;
    issues.push({
      code: 'MISSING_AGENTS_MD',
      severity: 'info',
      message: 'AGENTS.md is missing.',
      file: 'AGENTS.md',
      fixable: true,
      suggestion: 'Run "img-upload-kit agents" or "img-upload-kit doctor --fix".',
    });
  } else {
    try {
      const current = await fs.readFile(path.join(cwd, 'AGENTS.md'), 'utf8');
      const hasMarkers =
        current.includes(AGENTS_MARKER_START) && current.includes(AGENTS_MARKER_END);
      if (!hasMarkers || agentsPlan.changed) {
        agentsIssue = true;
        issues.push({
          code: 'OUTDATED_AGENTS_MD',
          severity: 'info',
          message: hasMarkers
            ? 'AGENTS.md img-upload-kit section is outdated.'
            : 'AGENTS.md is missing img-upload-kit managed markers.',
          file: 'AGENTS.md',
          fixable: true,
          suggestion: 'Run "img-upload-kit agents --update" or "img-upload-kit doctor --fix".',
        });
      }
    } catch {
      // Ignore read errors
    }
  }

  if (options.fix && agentsIssue && agentsPlan.changed) {
    fixFiles.push({
      relativePath: 'AGENTS.md',
      content: agentsPlan.content,
      description: 'Update AGENTS.md managed section',
      mode: 'merge',
    });
  }

  if (options.fix && fixFiles.length > 0) {
    const res = await applyFileWrites(cwd, fixFiles, { dryRun: Boolean(options.dryRun) });
    for (const writtenPath of res.written) {
      appliedFixes.push(
        options.dryRun ? `[dry-run] would update ${writtenPath}` : `updated ${writtenPath}`,
      );
    }
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return {
    cwd,
    ok: !hasErrors,
    issues,
    appliedFixes,
  };
}
