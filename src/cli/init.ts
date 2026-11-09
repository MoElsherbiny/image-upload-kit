import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import {
  BASE_FRAMEWORK_OPTIONS,
  buildInstallCommand,
  buildStarterSnippet,
  detectProjectEnvironment,
  type InitFramework,
  type InitStorageAdapter,
  normalizeFrameworkOption,
  normalizePmOption,
  normalizeStorageOption,
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

const SAFE_PKG_SPEC_RE = /^[@a-z0-9._/-]+$/i;

async function ensurePackageJson(cwd: string): Promise<boolean> {
  const pkgPath = path.join(cwd, 'package.json');
  try {
    await fs.access(pkgPath);
    return false;
  } catch {
    const rawName = path
      .basename(path.resolve(cwd))
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '');
    const initialPkg = {
      name: rawName || 'my-app',
      version: '0.1.0',
      private: true,
    };
    await fs.writeFile(pkgPath, `${JSON.stringify(initialPkg, null, 2)}\n`, 'utf8');
    return true;
  }
}

function defaultExecInstall(
  pm: PackageManagerName,
  packages: readonly string[],
  cwd: string,
): Promise<void> {
  for (const pkg of packages) {
    if (!SAFE_PKG_SPEC_RE.test(pkg)) {
      return Promise.reject(new Error(`Invalid package specifier: ${pkg}`));
    }
  }
  const args = pm === 'npm' ? ['i', ...packages] : ['add', ...packages];
  const fullCmd = `${pm} ${args.join(' ')}`;
  return new Promise<void>((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(fullCmd, { cwd, stdio: 'inherit', shell: true })
        : spawn(pm, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${fullCmd} exited with code ${String(code)}`));
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
  const pm = normalizePmOption(opts.pm) ?? env.pm;
  const explicitFramework = normalizeFrameworkOption(opts.framework);
  const explicitStorage = normalizeStorageOption(opts.storage);

  renderCliIntro(
    `img-upload-kit v${opts.version ?? '2.2.5'}`,
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
    explicitFramework ??
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

  let selectedStorage: InitStorageAdapter = explicitStorage ?? 'local';
  if (!explicitStorage && needsStoragePrompt) {
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
    const isInteractiveTty = Boolean(input.isTTY && output.isTTY);
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
      initialValue: nonInteractive || isInteractiveTty ? 'install' : 'print',
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
    const createdPkg = await ensurePackageJson(cwd);
    if (createdPkg) {
      renderCliStep('Initialized project', 'created package.json', output);
    }
    renderCliStep('Installing packages', installCommand, output);
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
      : `Ready! Run "npx img-upload-kit@latest init --yes" to install dependencies.`,
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
