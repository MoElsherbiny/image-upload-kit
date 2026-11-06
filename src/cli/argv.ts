import { parseArgs } from 'node:util';

export interface CliOptionDef {
  flags: string;
  description: string;
  defaultValue?: string | boolean;
  short?: string;
  long: string;
  takesValue: boolean;
  negatedKey?: string;
}

export type CliActionHandler = (
  ...args: never[]
) => Promise<void> | void;

export interface CliCommandDef {
  name: string;
  hasPositionalArg: boolean;
  descriptionText: string;
  options: CliOptionDef[];
  actionFn?: (...args: unknown[]) => Promise<void> | void;
}

function parseOptionSpec(
  flags: string,
  description: string,
  defaultValue?: string | boolean,
): CliOptionDef {
  const parts = flags.split(',').map((p) => p.trim());
  let short: string | undefined;
  let long = '';
  let takesValue = false;

  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const flagToken = tokens[0];
    if (tokens.length > 1) takesValue = true;
    if (flagToken.startsWith('--')) {
      long = flagToken.slice(2);
    } else if (flagToken.startsWith('-')) {
      short = flagToken.slice(1);
    }
  }

  const negatedKey = long.startsWith('no-') ? long.slice(3) : undefined;
  return {
    flags,
    description,
    defaultValue,
    short,
    long,
    takesValue,
    negatedKey,
  };
}

function toCamelCase(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

export class CliCommandBuilder {
  readonly def: CliCommandDef;

  constructor(spec: string) {
    const tokens = spec.trim().split(/\s+/);
    this.def = {
      name: tokens[0],
      hasPositionalArg: tokens.length > 1,
      descriptionText: '',
      options: [],
    };
  }

  description(text: string): this {
    this.def.descriptionText = text;
    return this;
  }

  option(
    flags: string,
    description: string,
    defaultValue?: string | boolean,
  ): this {
    this.def.options.push(parseOptionSpec(flags, description, defaultValue));
    return this;
  }

  action<TArgs extends unknown[]>(
    fn: (...args: TArgs) => Promise<void> | void,
  ): this {
    this.def.actionFn = fn as (...args: unknown[]) => Promise<void> | void;
    return this;
  }
}

export class ZeroDepCliProgram {
  private programName = 'img-upload-kit';
  private programDescription = '';
  private programVersion = '2.2.0';
  private readonly commands = new Map<string, CliCommandDef>();

  name(): string;
  name(n: string): this;
  name(n?: string): string | this {
    if (n === undefined) return this.programName;
    this.programName = n;
    return this;
  }

  description(): string;
  description(desc: string): this;
  description(desc?: string): string | this {
    if (desc === undefined) return this.programDescription;
    this.programDescription = desc;
    return this;
  }

  version(): string;
  version(v: string): this;
  version(v?: string): string | this {
    if (v === undefined) return this.programVersion;
    this.programVersion = v;
    return this;
  }

  command(spec: string): CliCommandBuilder {
    const builder = new CliCommandBuilder(spec);
    this.commands.set(builder.def.name, builder.def);
    return builder;
  }

  formatHelp(): string {
    const lines = [
      `${this.programName} v${this.programVersion}`,
      this.programDescription,
      '',
      'Commands:',
    ];
    for (const cmd of this.commands.values()) {
      lines.push(`  ${cmd.name.padEnd(16)} ${cmd.descriptionText}`);
    }
    return lines.join('\n');
  }

  async parseAsync(
    argv: string[] = process.argv,
    parseOpts?: { from?: 'user' | 'node' },
  ): Promise<this> {
    const userArgs =
      parseOpts?.from === 'user' ? [...argv] : argv.slice(2);

    if (
      userArgs.length === 0 ||
      userArgs[0] === 'help' ||
      userArgs.includes('--help') ||
      userArgs.includes('-h')
    ) {
      console.log(this.formatHelp());
      return this;
    }

    if (userArgs.includes('--version') || userArgs.includes('-V')) {
      console.log(this.programVersion);
      return this;
    }

    const subcommandName = userArgs[0];
    const cmd = this.commands.get(subcommandName);
    if (!cmd || !cmd.actionFn) {
      console.error(`Unknown command: ${subcommandName}`);
      process.exitCode = 1;
      return this;
    }

    const rawCmdArgs = userArgs.slice(1);
    const parseConfigOptions: Record<
      string,
      { type: 'string' | 'boolean'; short?: string }
    > = {};

    for (const opt of cmd.options) {
      parseConfigOptions[opt.long] = {
        type: opt.takesValue ? 'string' : 'boolean',
        ...(opt.short ? { short: opt.short } : {}),
      };
    }

    const { values, positionals } = parseArgs({
      args: rawCmdArgs,
      options: parseConfigOptions,
      allowPositionals: true,
      strict: false,
    });

    const resolvedOpts: Record<string, unknown> = {};
    for (const opt of cmd.options) {
      if (opt.negatedKey) {
        const camelNeg = toCamelCase(opt.negatedKey);
        resolvedOpts[camelNeg] = values[opt.long] === true ? false : true;
        continue;
      }
      const camelKey = toCamelCase(opt.long);
      const rawVal = values[opt.long];
      resolvedOpts[camelKey] =
        rawVal !== undefined ? rawVal : opt.defaultValue;
    }

    if (cmd.hasPositionalArg) {
      const positional = positionals[0] ?? '';
      await cmd.actionFn(positional, resolvedOpts);
    } else {
      await cmd.actionFn(resolvedOpts);
    }

    return this;
  }
}
