import fs from 'node:fs/promises';
import path from 'node:path';
import { planAgentsMdUpdate } from '../filesystem/agentsManager';
import { planEnvTemplateMerge } from '../filesystem/envManager';
import type {
  ArchitectureRecommendation,
  DependencyPlan,
  PlannedFile,
} from '../types/architecture';
import type { ProjectDetectionReport } from '../types/detection';
import { buildAgentsManagedSection } from './agentsTemplate';
import { buildEnvEntriesForRecommendation } from './envTemplate';
import { buildFrameworkScaffolds } from './frameworkTemplates';
import { buildStorageAdapterFile } from './storageTemplates';

async function hasDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export interface ScaffoldPlanOptions {
  includeStorage?: boolean;
  includeFrameworkFiles?: boolean;
  includeEnv?: boolean;
  includeAgentsMd?: boolean;
}

export async function buildScaffoldPlan(
  report: ProjectDetectionReport,
  rec: ArchitectureRecommendation,
  deps: DependencyPlan,
  options: ScaffoldPlanOptions = {},
): Promise<PlannedFile[]> {
  const {
    includeStorage = rec.runtimeCapability.supportsSharp,
    includeFrameworkFiles = true,
    includeEnv = true,
    includeAgentsMd = true,
  } = options;

  const files: PlannedFile[] = [];

  if (includeStorage) {
    const storageFile = buildStorageAdapterFile(rec.storage);
    files.push({
      relativePath: storageFile.relativePath,
      content: storageFile.content,
      description: storageFile.description,
      mode: 'create',
    });
  }

  if (includeFrameworkFiles) {
    const hasSrcApp =
      rec.backend === 'nextjs-node'
        ? await hasDirectory(path.join(report.cwd, 'src', 'app'))
        : false;
    files.push(...buildFrameworkScaffolds(rec, { hasSrcApp }));
  }

  if (includeEnv) {
    const envEntries = buildEnvEntriesForRecommendation(rec);
    if (envEntries.length > 0) {
      const envMerge = await planEnvTemplateMerge(report.cwd, envEntries);
      if (envMerge.addedKeys.length > 0) {
        files.push({
          relativePath: envMerge.targetFileName,
          content: envMerge.mergedContent,
          description: `Merge ${envMerge.addedKeys.length} missing env key(s) into ${envMerge.targetFileName}`,
          mode: 'merge',
        });
      }
    }
  }

  if (includeAgentsMd) {
    const managedBody = buildAgentsManagedSection(report, rec, deps);
    const agentsPlan = await planAgentsMdUpdate(report.cwd, managedBody);
    if (agentsPlan.changed) {
      files.push({
        relativePath: agentsPlan.relativePath,
        content: agentsPlan.content,
        description: agentsPlan.existed
          ? 'Update img-upload-kit managed section in AGENTS.md'
          : 'Create AGENTS.md with img-upload-kit integration guide',
        mode: 'merge',
      });
    }
  }

  return files;
}
