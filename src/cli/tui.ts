import type { Readable, Writable } from 'node:stream';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
  badge?: string;
}

export interface SelectPromptConfig<T extends string = string> {
  message: string;
  options: readonly SelectOption<T>[];
  initialValue?: T;
  input?: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  output?: Writable & { isTTY?: boolean };
  nonInteractive?: boolean;
}

const ESC = '\x1b[';
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const CLEAR_LINE = `${ESC}2K\r`;

function tokenizeKeyInput(raw: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\x1b' && i + 2 < raw.length && (raw[i + 1] === '[' || raw[i + 1] === 'O')) {
      tokens.push(raw.slice(i, i + 3));
      i += 2;
    } else if (ch === '\r' && raw[i + 1] === '\n') {
      tokens.push('\r\n');
      i += 1;
    } else {
      tokens.push(ch);
    }
  }
  return tokens;
}

function supportsColor(output?: { isTTY?: boolean }): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  return Boolean(output?.isTTY ?? process.stdout.isTTY);
}

export function createAnsiPalette(enabled: boolean) {
  const wrap = (code: string, reset = '0') =>
    enabled ? (text: string) => `${ESC}${code}m${text}${ESC}${reset}m` : (text: string) => text;
  return {
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    cyan: wrap('36', '39'),
    brightCyan: wrap('96', '39'),
    green: wrap('32', '39'),
    brightGreen: wrap('92', '39'),
    yellow: wrap('33', '39'),
    red: wrap('31', '39'),
    gray: wrap('90', '39'),
    bgCyanBlack: enabled
      ? (text: string) => `${ESC}46;30;1m ${text} ${ESC}0m`
      : (text: string) => `[${text}]`,
  };
}

export function renderCliIntro(
  title: string,
  subtitle: string,
  output: Writable & { isTTY?: boolean } = process.stdout,
): void {
  const c = createAnsiPalette(supportsColor(output));
  output.write(`\n${c.cyan('┌')}  ${c.bgCyanBlack(title)} ${c.dim(subtitle)}\n${c.cyan('│')}\n`);
}

export function renderCliStep(
  label: string,
  detail: string,
  output: Writable & { isTTY?: boolean } = process.stdout,
): void {
  const c = createAnsiPalette(supportsColor(output));
  output.write(`${c.green('◇')}  ${c.bold(label)} ${c.dim('·')} ${c.brightCyan(detail)}\n${c.cyan('│')}\n`);
}

export function renderCliNote(
  title: string,
  lines: readonly string[],
  output: Writable & { isTTY?: boolean } = process.stdout,
): void {
  const c = createAnsiPalette(supportsColor(output));
  output.write(`${c.cyan('◆')}  ${c.bold(title)}\n`);
  for (const line of lines) {
    output.write(`${c.cyan('│')}  ${line}\n`);
  }
  output.write(`${c.cyan('│')}\n`);
}

export function renderCliOutro(
  message: string,
  output: Writable & { isTTY?: boolean } = process.stdout,
): void {
  const c = createAnsiPalette(supportsColor(output));
  output.write(`${c.cyan('└')}  ${c.brightGreen('✔')} ${c.bold(message)}\n\n`);
}

/**
 * Interactive arrow-key dropdown selector for the terminal.
 * Falls back gracefully to `initialValue` (or first option) when non-interactive or non-TTY.
 */
export async function promptSelect<T extends string = string>(
  config: SelectPromptConfig<T>,
): Promise<T | null> {
  const input = config.input ?? process.stdin;
  const output = config.output ?? process.stdout;
  const c = createAnsiPalette(supportsColor(output));
  const options = config.options;

  if (options.length === 0) {
    throw new Error('promptSelect requires at least one option');
  }

  const initialIdx = config.initialValue
    ? Math.max(
        0,
        options.findIndex((o) => o.value === config.initialValue),
      )
    : 0;

  if (config.nonInteractive || !input.isTTY || !output.isTTY) {
    const chosen = options[initialIdx] ?? options[0];
    output.write(
      `${c.green('◇')}  ${c.bold(config.message)} ${c.dim('·')} ${c.brightCyan(chosen.label)}\n${c.cyan('│')}\n`,
    );
    return chosen.value;
  }

  return new Promise<T | null>((resolve) => {
    let selectedIdx = initialIdx;
    let renderedLines = 0;

    const renderMenu = (collapsed = false, cancelled = false) => {
      if (renderedLines > 0) {
        output.write(`${ESC}${renderedLines}A`);
        for (let i = 0; i < renderedLines; i++) {
          output.write(`${CLEAR_LINE}${ i < renderedLines - 1 ? '\n' : '' }`);
        }
        if (renderedLines > 1) {
          output.write(`${ESC}${renderedLines - 1}A`);
        }
      }

      if (collapsed) {
        const chosen = options[selectedIdx];
        const symbol = cancelled ? c.red('■') : c.green('◇');
        const valueLabel = cancelled
          ? c.dim('Cancelled')
          : c.brightCyan(chosen.label);
        output.write(
          `${CLEAR_LINE}${symbol}  ${c.bold(config.message)} ${c.dim('·')} ${valueLabel}\n${c.cyan('│')}\n`,
        );
        renderedLines = 2;
        return;
      }

      const lines: string[] = [];
      lines.push(
        `${c.brightCyan('◆')}  ${c.bold(config.message)} ${c.dim('(Use ↑/↓ arrows, 1-' + String(options.length) + ', Enter to confirm)')}`,
      );

      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const isSelected = i === selectedIdx;
        const radio = isSelected ? c.brightGreen('●') : c.gray('○');
        const label = isSelected ? c.brightCyan(c.bold(opt.label)) : opt.label;
        const badge = opt.badge ? ` ${c.yellow(`[${opt.badge}]`)}` : '';
        const hint = opt.hint ? ` ${c.dim(`— ${opt.hint}`)}` : '';
        lines.push(`${c.cyan('│')}  ${radio} ${label}${badge}${hint}`);
      }
      lines.push(`${c.cyan('│')}`);

      output.write(lines.join('\n') + '\n');
      renderedLines = lines.length;
    };

    const cleanup = () => {
      input.removeListener('data', onData);
      if (typeof input.setRawMode === 'function') {
        input.setRawMode(false);
      }
      input.pause();
      output.write(SHOW_CURSOR);
    };

    const onData = (chunk: Buffer | string) => {
      const raw = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const tokens = tokenizeKeyInput(raw);

      for (const seq of tokens) {
        // Ctrl+C or Escape
        if (seq === '\x03' || seq === '\x1b') {
          renderMenu(true, true);
          cleanup();
          resolve(null);
          return;
        }

        // Enter or Space
        if (seq === '\r' || seq === '\n' || seq === '\r\n' || seq === ' ') {
          renderMenu(true, false);
          cleanup();
          resolve(options[selectedIdx].value);
          return;
        }

        // Up arrow (\x1b[A or \x1bOA) or 'k'
        if (seq === '\x1b[A' || seq === '\x1bOA' || seq === 'k') {
          selectedIdx = (selectedIdx - 1 + options.length) % options.length;
          renderMenu(false);
          continue;
        }

        // Down arrow (\x1b[B or \x1bOB) or 'j'
        if (seq === '\x1b[B' || seq === '\x1bOB' || seq === 'j') {
          selectedIdx = (selectedIdx + 1) % options.length;
          renderMenu(false);
          continue;
        }

        // Number key shortcut (1..9)
        if (/^[1-9]$/.test(seq)) {
          const numIdx = Number.parseInt(seq, 10) - 1;
          if (numIdx >= 0 && numIdx < options.length) {
            selectedIdx = numIdx;
            renderMenu(false);
          }
        }
      }
    };

    output.write(HIDE_CURSOR);
    if (typeof input.setRawMode === 'function') {
      input.setRawMode(true);
    }
    input.resume();
    input.on('data', onData);
    renderMenu(false);
  });
}
