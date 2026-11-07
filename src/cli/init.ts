import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import {
  BASE_FRAMEWORK_OPTIONS,
  buildInstallCommand,
  buildStarterSnippet,
  detectProjectEnvironment,
  type InitFramework,
  type InitStorageAdapter,
  type PackageManagerName,
  resolvePackagesToInstall,
  STORAGE_OPTIONS,
} from './detect';
import {
  createAnsiPalette,
  promptSelect,
  renderCliIntro,
  renderCliNote,
  renderCliOutro,
  renderCliStep,
} from './tui';

export * from './detect';

export interface RunInitOptions {
  cwd?: string;
  framework?: InitFramework;
  storage?: InitStorageAdapter;
  pm?: PackageManagerName;
  yes?: boolean;
  install?: boolean;
  version?: string;
  input?: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  output?: Writable & { isTTY?: boolean };
  execInstall?: (
    pm: PackageManagerName,
    packages: readonly string[],
    cwd: string,
  ) => Promise<void>;
}

export interface RunInitResult {
  cancelled: boolean;
  framework: InitFramework;
  storage: InitStorageAdapter;
  pm: PackageManagerName;
  packages: string[];
  installCommand: string;
  installed: boolean;
}

function defaultExecInstall(
  pm: PackageManagerName,
  packages: readonly string[],
  cwd: string,
): Promise<void> {
  const args = pm === 'npm' ? ['i', ...packages] : ['add', ...packages];
  return new Promise<void>((resolve, reject) => {
    const child = spawn(pm, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${pm} ${args.join(' ')} exited with code ${String(code)}`));
    });
  });
}

export async function runInteractiveInit(
  opts: RunInitOptions = {},
): Promise<RunInitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const output = opts.output ?? process.stdout;
  const input = opts.input ?? process.stdin;
  const nonInteractive = Boolean(opts.yes);
  const env = await detectProjectEnvironment(cwd);
  const pm = opts.pm ?? env.pm;

  renderCliIntro(
    `img-upload-kit v${opts.version ?? '2.2.1'}`,
    'Interactive Framework & Storage Setup',
    output,
  );

  if (env.detectedFrameworkName) {
    renderCliStep(
      'Detected environment',
      `${env.detectedFrameworkName} (${pm})`,
      output,
    );
  }

  const frameworkChoices = BASE_FRAMEWORK_OPTIONS.map((opt) =>
    env.detectedFrameworkName && opt.value === env.framework
      ? { ...opt, badge: 'Detected' }
      : opt,
  );

  const selectedFramework =
    opts.framework ??
    (await promptSelect<InitFramework>({
      message: 'Select your framework / platform:',
      options: frameworkChoices,
      initialValue: env.framework,
      input,
      output,
      nonInteractive,
    }));

  if (!selectedFramework) {
    return {
      cancelled: true,
      framework: env.framework,
      storage: 'local',
      pm,
      packages: [],
      installCommand: '',
      installed: false,
    };
  }

  const needsStoragePrompt =
    selectedFramework !== 'react-native' && selectedFramework !== 'client';

  let selectedStorage: InitStorageAdapter = opts.storage ?? 'local';
  if (!opts.storage && needsStoragePrompt) {
    const chosenStorage = await promptSelect<InitStorageAdapter>({
      message: 'Select your server storage adapter:',
      options: STORAGE_OPTIONS,
      initialValue: 'local',
      input,
      output,
      nonInteractive,
    });
    if (!chosenStorage) {
      return {
        cancelled: true,
        framework: selectedFramework,
        storage: 'local',
        pm,
        packages: [],
        installCommand: '',
        installed: false,
      };
    }
    selectedStorage = chosenStorage;
  }

  const packages = resolvePackagesToInstall(
    selectedFramework,
    selectedStorage,
    env.installedPackages,
  );
  const installCommand = buildInstallCommand(pm, packages);

  let shouldInstall = opts.install;
  if (shouldInstall === undefined) {
    const mode = await promptSelect<'install' | 'print'>({
      message: `Install dependencies now? (${installCommand})`,
      options: [
        {
          value: 'install',
          label: `Yes — run "${installCommand}" now`,
          hint: 'installs selected framework & storage packages automatically',
        },
        {
          value: 'print',
          label: 'No — show install command & starter imports only',
          hint: 'zero disk changes',
        },
      ],
      initialValue: nonInteractive ? 'print' : 'install',
      input,
      output,
      nonInteractive,
    });
    if (!mode) {
      return {
        cancelled: true,
        framework: selectedFramework,
        storage: selectedStorage,
        pm,
        packages,
        installCommand,
        installed: false,
      };
    }
    shouldInstall = mode === 'install';
  }

  let installed = false;
  if (shouldInstall) {
    const runner = opts.execInstall ?? defaultExecInstall;
    await runner(pm, packages, cwd);
    installed = true;
  }

  const c = createAnsiPalette(Boolean(output.isTTY));
  renderCliNote(
    'Quick Start Imports',
    [
      c.brightCyan(`$ ${installCommand}`),
      '',
      ...buildStarterSnippet(selectedFramework, selectedStorage).map((l) => c.green(l)),
    ],
    output,
  );
  renderCliOutro(
    installed
      ? `Installed ${packages.join(', ')} for ${selectedFramework}!`
      : `Ready! Run "${installCommand}" to finish setup.`,
    output,
  );

  return {
    cancelled: false,
    framework: selectedFramework,
    storage: selectedStorage,
    pm,
    packages,
    installCommand,
    installed,
  };
}
