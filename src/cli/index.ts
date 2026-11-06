import { createCliProgram } from './commands';

export * from './scanner';
export * from './generator';
export * from './validation';
export { createCliProgram };

const CLI_SUBCOMMANDS = new Set([
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
    await program.parseAsync(process.argv);
    return;
  }
  const isUserArgs =
    argv.length === 0 ||
    CLI_SUBCOMMANDS.has(argv[0]) ||
    argv[0].startsWith('-');
  await program.parseAsync(argv, isUserArgs ? { from: 'user' } : undefined);
}
