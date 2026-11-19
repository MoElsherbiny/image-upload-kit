import { createCliProgram } from './commands';

export * from './scanner';
export * from './generator';
export * from './validation';
export * from './tui';
export * from './init';
export * from './types/detection';
export * from './types/architecture';
export * from './capabilities/storageRegistry';
export * from './capabilities/runtimeRegistry';
export * from './detection/envInspector';
export * from './detection/layerDetectors';
export * from './detection/projectDetector';
export * from './recommendations/architectureResolver';
export * from './recommendations/dependencyPlanner';
export * from './filesystem/fileManager';
export * from './filesystem/envManager';
export * from './filesystem/agentsManager';
export * from './generators/envTemplate';
export * from './generators/agentsTemplate';
export * from './generators/storageTemplates';
export * from './generators/frameworkTemplates';
export * from './generators/scaffoldPlanner';
export * from './validation/projectValidator';
export * from './validation/doctorEngine';
export * from './commands/doctorCommand';
export * from './commands/validateCommand';
export * from './commands/agentsCommand';
export * from './commands/configCommand';
export { createCliProgram };

const CLI_SUBCOMMANDS = new Set([
  'init',
  'setup',
  'doctor',
  'agents',
  'config',
  'generate',
  'validate',
  'sync',
  'cleanup',
  'health',
  'inspect',
  'help',
]);

const HELP_OR_VERSION_FLAGS = new Set(['-h', '--help', '-V', '--version']);

export async function runCli(argv?: string[]): Promise<void> {
  const program = createCliProgram();
  if (!argv) {
    const rawUserArgs = process.argv.slice(2);
    if (
      rawUserArgs.length === 0 &&
      process.stdin.isTTY &&
      process.stdout.isTTY
    ) {
      await program.parseAsync(['init'], { from: 'user' });
      return;
    }
    if (
      rawUserArgs.length > 0 &&
      rawUserArgs[0].startsWith('-') &&
      !HELP_OR_VERSION_FLAGS.has(rawUserArgs[0])
    ) {
      await program.parseAsync(['init', ...rawUserArgs], { from: 'user' });
      return;
    }
    await program.parseAsync(process.argv);
    return;
  }
  if (
    argv.length > 0 &&
    argv[0].startsWith('-') &&
    !HELP_OR_VERSION_FLAGS.has(argv[0])
  ) {
    await program.parseAsync(['init', ...argv], { from: 'user' });
    return;
  }
  const isUserArgs =
    argv.length === 0 ||
    CLI_SUBCOMMANDS.has(argv[0]) ||
    argv[0].startsWith('-');
  await program.parseAsync(argv, isUserArgs ? { from: 'user' } : undefined);
}
