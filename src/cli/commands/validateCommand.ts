import { validateBlurHashFile } from '../validation';
import { validateProjectIntegration } from '../validation/projectValidator';

export interface ValidateCommandOptions {
  cwd?: string;
  file?: string;
  manifest?: string;
}

export async function runValidateCommand(
  opts: ValidateCommandOptions = {},
): Promise<void> {
  const explicitManifest = opts.manifest ?? opts.file;
  if (explicitManifest) {
    const result = await validateBlurHashFile(explicitManifest);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    if (!result.valid) {
      for (const error of result.errors) console.error(`Error: ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Manifest is valid (${result.totalEntries} entries).`);
    return;
  }

  const projectResult = await validateProjectIntegration(opts.cwd);
  for (const warning of projectResult.warnings) {
    console.warn(`Warning: ${warning}`);
  }
  if (!projectResult.valid) {
    for (const error of projectResult.errors) {
      console.error(`Error: ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Project integration is valid (${projectResult.checksRun.length} checks passed).`,
  );
}
