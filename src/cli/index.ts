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
    await program.parseAsync(process.argv);
    return;
  }
  const isUserArgs =
    argv.length === 0 ||
    CLI_SUBCOMMANDS.has(argv[0]) ||
    argv[0].startsWith('-');
  await program.parseAsync(argv, isUserArgs ? { from: 'user' } : undefined);
}
