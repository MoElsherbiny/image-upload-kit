import { runDoctor } from '../validation/doctorEngine';

export interface DoctorCommandOptions {
  cwd?: string;
  fix?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export async function runDoctorCommand(
  opts: DoctorCommandOptions = {},
): Promise<void> {
  const report = await runDoctor({
    cwd: opts.cwd,
    fix: Boolean(opts.fix),
    dryRun: Boolean(opts.dryRun),
  });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (report.issues.length === 0) {
    console.log('Doctor: no issues found.');
    return;
  }

  for (const issue of report.issues) {
    const prefix =
      issue.severity === 'error'
        ? '[ERROR]'
        : issue.severity === 'warning'
          ? '[WARN]'
          : '[INFO]';
    console.log(`${prefix} ${issue.code}: ${issue.message}`);
    if (issue.suggestion) {
      console.log(`  -> ${issue.suggestion}`);
    }
  }

  for (const fix of report.appliedFixes) {
    console.log(`Fixed: ${fix}`);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}
