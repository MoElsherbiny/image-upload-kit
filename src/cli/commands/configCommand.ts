import path from 'node:path';
import { isSensitiveEnvKeyName } from '../detection/envInspector';
import { detectProject } from '../detection/projectDetector';
import { resolveArchitecture } from '../recommendations/architectureResolver';
import { planDependencies } from '../recommendations/dependencyPlanner';

export interface RedactedConfigSnapshot {
  cwd: string;
  packageManager: string;
  monorepo: { isMonorepo: boolean; tool: string };
  detected: {
    frontend: string;
    backend: string;
    storage: string;
    cdn: string;
    auth: string;
  };
  resolved: {
    frontend: string;
    backend: string;
    storage: string;
    supportLevel: string;
    supportsSharp: boolean;
    requiresCustomAdapter: boolean;
    requiresSeparateProcessingBackend: boolean;
    selectedReason: string;
  };
  dependencies: {
    toInstall: string[];
    alreadyInstalled: string[];
    skippedServerDeps: string[];
    installCommand: string;
  };
  envTemplates: Array<{
    fileName: string;
    keys: Array<{ key: string; redacted: boolean }>;
  }>;
}

export async function buildRedactedConfigSnapshot(
  cwd: string = process.cwd(),
): Promise<RedactedConfigSnapshot> {
  const resolvedCwd = path.resolve(cwd);
  const report = await detectProject(resolvedCwd);
  const rec = resolveArchitecture(report);
  const deps = planDependencies(report, rec);

  return {
    cwd: report.cwd,
    packageManager: report.packageManager,
    monorepo: {
      isMonorepo: report.monorepo.isMonorepo,
      tool: report.monorepo.tool,
    },
    detected: {
      frontend: report.frontend.detected,
      backend: report.backend.detected,
      storage: report.storage.detected,
      cdn: report.cdn.detected,
      auth: report.auth.detected,
    },
    resolved: {
      frontend: rec.frontend,
      backend: rec.backend,
      storage: rec.storage,
      supportLevel: rec.storageCapability.supportLevel,
      supportsSharp: rec.runtimeCapability.supportsSharp,
      requiresCustomAdapter: rec.requiresCustomAdapter,
      requiresSeparateProcessingBackend: rec.requiresSeparateProcessingBackend,
      selectedReason: rec.selectedReason,
    },
    dependencies: {
      toInstall: deps.toInstall,
      alreadyInstalled: deps.alreadyInstalled,
      skippedServerDeps: deps.skippedServerDeps,
      installCommand: deps.installCommand,
    },
    envTemplates: report.envFiles.map((file) => ({
      fileName: file.fileName,
      keys: file.keys.map((key) => ({
        key,
        redacted: isSensitiveEnvKeyName(key),
      })),
    })),
  };
}

export async function runConfigCommand(opts: { cwd?: string } = {}): Promise<void> {
  const snapshot = await buildRedactedConfigSnapshot(opts.cwd);
  console.log(JSON.stringify(snapshot, null, 2));
}
