import path from 'node:path';
import { detectProject } from '../detection/projectDetector';
import { planAgentsMdUpdate } from '../filesystem/agentsManager';
import { applyFileWrites } from '../filesystem/fileManager';
import { buildAgentsManagedSection } from '../generators/agentsTemplate';
import { resolveArchitecture } from '../recommendations/architectureResolver';
import { planDependencies } from '../recommendations/dependencyPlanner';

export interface AgentsCommandOptions {
  cwd?: string;
  update?: boolean;
  dryRun?: boolean;
}

export interface AgentsCommandResult {
  relativePath: string;
  existed: boolean;
  hadMarkers: boolean;
  changed: boolean;
  written: boolean;
  dryRun: boolean;
}

export async function runAgentsCommand(
  opts: AgentsCommandOptions = {},
): Promise<AgentsCommandResult> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const report = await detectProject(cwd);
  const rec = resolveArchitecture(report);
  const deps = planDependencies(report, rec);
  const section = buildAgentsManagedSection(report, rec, deps);
  const plan = await planAgentsMdUpdate(cwd, section);

  if (plan.existed && !opts.update) {
    console.log(
      'AGENTS.md already exists. Pass --update to safely update the img-upload-kit managed section.',
    );
    return {
      relativePath: plan.relativePath,
      existed: plan.existed,
      hadMarkers: plan.hadMarkers,
      changed: plan.changed,
      written: false,
      dryRun: Boolean(opts.dryRun),
    };
  }

  if (!plan.changed) {
    console.log('AGENTS.md is already up to date.');
    return {
      relativePath: plan.relativePath,
      existed: plan.existed,
      hadMarkers: plan.hadMarkers,
      changed: false,
      written: false,
      dryRun: Boolean(opts.dryRun),
    };
  }

  const writeRes = await applyFileWrites(
    cwd,
    [
      {
        relativePath: plan.relativePath,
        content: plan.content,
        description: 'Update AGENTS.md managed section',
        mode: 'merge',
      },
    ],
    { dryRun: Boolean(opts.dryRun) },
  );

  const verb = opts.dryRun ? '[Dry Run] Would write' : plan.existed ? 'Updated' : 'Created';
  console.log(`${verb} ${plan.relativePath} (user content outside markers preserved).`);

  return {
    relativePath: plan.relativePath,
    existed: plan.existed,
    hadMarkers: plan.hadMarkers,
    changed: plan.changed,
    written: !opts.dryRun && writeRes.written.length > 0,
    dryRun: Boolean(opts.dryRun),
  };
}
