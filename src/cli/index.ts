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

function isDirectCliExecution(entryArg?: string): boolean {
  if (!entryArg) return false;
  const normalized = entryArg.replace(/\\/g, '/');
  return (
    normalized === 'cli.js' ||
    normalized === 'cli.cjs' ||
    normalized.endsWith('/cli.js') ||
    normalized.endsWith('/cli.cjs') ||
    normalized.endsWith('/cli/index.ts') ||
    normalized.endsWith('/bin/image-upload-kit') ||
    normalized.endsWith('/.bin/image-upload-kit') ||
    normalized.endsWith('/bin/blur-cli') ||
    normalized.endsWith('/.bin/blur-cli')
  );
}

if (typeof process !== 'undefined' && isDirectCliExecution(process.argv?.[1])) {
  void runCli().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
