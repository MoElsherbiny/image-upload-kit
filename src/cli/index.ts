import { createCliProgram } from './commands';

export * from './scanner';
export * from './generator';
export * from './validation';
export * from './tui';
export * from './init';
export { createCliProgram };

const CLI_SUBCOMMANDS = new Set([
  'init',
  'setup',
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
