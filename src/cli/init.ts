import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { STORAGE_CAPABILITIES } from './capabilities/storageRegistry';
import {
  BASE_FRAMEWORK_OPTIONS, buildInstallCommand, buildStarterSnippet, buildStorageChoices,
  type InitFramework, type InitStorageAdapter, normalizeFrameworkOption,
  normalizePmOption, normalizeStorageOption, type PackageManagerName,
} from './detect';
import { detectProject } from './detection/projectDetector';
import { applyFileWrites } from './filesystem/fileManager';
import { buildScaffoldPlan } from './generators/scaffoldPlanner';
import { type ArchitectureOverrides, resolveArchitecture } from './recommendations/architectureResolver';
import { planDependencies } from './recommendations/dependencyPlanner';
import {
  createAnsiPalette, promptSelect, renderCliIntro,
  renderCliNote, renderCliOutro, renderCliStep,
} from './tui';
import type {
  BackendRuntime, FrontendFramework, ProjectDetectionReport, StorageProviderId,
} from './types/detection';

export * from './detect';

export interface RunInitOptions {
  cwd?: string;
  framework?: InitFramework;
  storage?: InitStorageAdapter;
  pm?: PackageManagerName;
  yes?: boolean;
  install?: boolean;
  dryRun?: boolean;
  scaffold?: boolean;
  version?: string;
  input?: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  output?: Writable & { isTTY?: boolean };
  execInstall?: (pm: PackageManagerName, packages: readonly string[], cwd: string) => Promise<void>;
}

export interface RunInitResult {
  cancelled: boolean;
  framework: InitFramework;
  storage: InitStorageAdapter;
  pm: PackageManagerName;
  packages: string[];
  installCommand: string;
  installed: boolean;
  dryRun?: boolean;
  scaffoldedFiles?: string[];
}

const SAFE_PKG_SPEC_RE = /^[@a-z0-9._/-]+$/i;
const S3_PROVIDERS = new Set<StorageProviderId>(['s3', 'r2', 'minio', 'spaces', 'b2', 'custom-s3']);
const INIT_TO_FRONTEND: Record<InitFramework, FrontendFramework> = {
  react: 'react', vue: 'vue', angular: 'angular', 'react-native': 'expo', server: 'none', client: 'vanilla',
};

function mapDetectedToInitFramework(r: ProjectDetectionReport): {
  framework: InitFramework;
  detectedFrameworkName: string | null;
} {
  const fw = r.frontend.detected;
  const be = r.backend.detected;
  if (fw === 'expo') return { framework: 'react-native', detectedFrameworkName: 'Expo / React Native' };
  if (fw === 'react-native') return { framework: 'react-native', detectedFrameworkName: 'React Native' };
  if (fw === 'angular') return { framework: 'angular', detectedFrameworkName: 'Angular' };
  if (fw === 'nuxt') return { framework: 'vue', detectedFrameworkName: 'Nuxt / Vue' };
  if (fw === 'vue') return { framework: 'vue', detectedFrameworkName: 'Vue 3' };
  if (fw === 'nextjs') return { framework: 'react', detectedFrameworkName: 'Next.js / React' };
  if (fw === 'react') {
    const isVite = r.frontend.alternatives.includes('vite') || r.installedPackages.includes('vite');
    return { framework: 'react', detectedFrameworkName: isVite ? 'Vite / React' : 'React' };
  }
  if (fw === 'vite') return { framework: 'react', detectedFrameworkName: 'Vite' };
  if (be === 'cloudflare-workers') return { framework: 'server', detectedFrameworkName: 'Cloudflare Workers' };
  if (be === 'vercel-edge') return { framework: 'server', detectedFrameworkName: 'Vercel Edge' };
  if (be !== 'none' && be !== 'frontend-only') return { framework: 'server', detectedFrameworkName: 'Node.js Server' };
  return { framework: 'react', detectedFrameworkName: null };
}

function mapStorageToInitStorage(storage: StorageProviderId): InitStorageAdapter {
  if (S3_PROVIDERS.has(storage)) return 's3';
  if (storage === 'supabase' || storage === 'memory') return storage;
  if (STORAGE_CAPABILITIES[storage]?.requiresCustomAdapter) return 'custom';
  return 'local';
}

function resolveOverridesForInit(
  detected: ProjectDetectionReport,
  selectedFramework: InitFramework,
  detectedInitFramework: InitFramework,
  storage?: StorageProviderId,
): ArchitectureOverrides {
  const frontend: FrontendFramework =
    selectedFramework === detectedInitFramework && detected.frontend.detected !== 'none'
      ? detected.frontend.detected
      : INIT_TO_FRONTEND[selectedFramework];
  const detectedBe = detected.backend.detected;
  let backend: BackendRuntime;
  if (selectedFramework === 'react-native' || selectedFramework === 'client') {
    backend = 'frontend-only';
  } else if (detectedBe === 'cloudflare-workers' || detectedBe === 'vercel-edge') {
    backend = detectedBe;
  } else if (selectedFramework === detectedInitFramework && detectedBe === 'frontend-only') {
    backend = 'frontend-only';
  } else if (detectedBe !== 'none' && detectedBe !== 'frontend-only') {
    backend = detectedBe;
  } else {
    backend = 'node';
  }
  return { frontend, backend, storage };
}

function cancelledResult(
  framework: InitFramework,
  storage: InitStorageAdapter,
  pm: PackageManagerName,
  packages: string[] = [],
  installCommand = '',
): RunInitResult {
  return { cancelled: true, framework, storage, pm, packages, installCommand, installed: false };
}

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
    const initialPkg = { name: rawName || 'my-app', version: '0.1.0', private: true };
    await fs.writeFile(pkgPath, `${JSON.stringify(initialPkg, null, 2)}\n`, 'utf8');
    return true;
  }
}

function defaultExecInstall(pm: PackageManagerName, packages: readonly string[], cwd: string): Promise<void> {
  for (const pkg of packages) {
    if (!SAFE_PKG_SPEC_RE.test(pkg)) return Promise.reject(new Error(`Invalid package specifier: ${pkg}`));
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

export async function runInteractiveInit(opts: RunInitOptions = {}): Promise<RunInitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const output = opts.output ?? process.stdout;
  const input = opts.input ?? process.stdin;
  const nonInteractive = Boolean(opts.yes);
  const detected = await detectProject(cwd);
  const pm = normalizePmOption(opts.pm) ?? detected.packageManager;
  const explicitFramework = normalizeFrameworkOption(opts.framework);
  const explicitStorage = normalizeStorageOption(opts.storage);
  const detectedFw = mapDetectedToInitFramework(detected);

  renderCliIntro(`img-upload-kit v${opts.version ?? '2.3.0'}`, 'Interactive Framework & Storage Setup', output);
  if (detectedFw.detectedFrameworkName) {
    renderCliStep('Detected environment', `${detectedFw.detectedFrameworkName} (${pm})`, output);
  }

  const frameworkChoices = BASE_FRAMEWORK_OPTIONS.map((opt) =>
    detectedFw.detectedFrameworkName && opt.value === detectedFw.framework ? { ...opt, badge: 'Detected' } : opt,
  );
  const selectedFramework =
    explicitFramework ??
    (await promptSelect<InitFramework>({
      message: 'Select your framework / platform:',
      options: frameworkChoices,
      initialValue: detectedFw.framework,
      input,
      output,
      nonInteractive,
    }));
  if (!selectedFramework) return cancelledResult(detectedFw.framework, 'local', pm);

  const prelimOverrides = resolveOverridesForInit(detected, selectedFramework, detectedFw.framework, explicitStorage);
  const prelimRec = resolveArchitecture(detected, prelimOverrides);
  const defaultStorage = mapStorageToInitStorage(prelimRec.storage);
  const needsStoragePrompt =
    selectedFramework !== 'react-native' &&
    selectedFramework !== 'client' &&
    prelimRec.runtimeCapability.supportsSharp;

  let selectedStorage: InitStorageAdapter = explicitStorage ?? defaultStorage;
  if (!explicitStorage && needsStoragePrompt) {
    const storageChoices = buildStorageChoices(
      defaultStorage,
      detected.storage.detected !== 'unknown',
      prelimRec.storageCapability.displayName,
    );
    const chosenStorage = await promptSelect<InitStorageAdapter>({
      message: 'Select your server storage adapter:',
      options: storageChoices,
      initialValue: defaultStorage,
      input,
      output,
      nonInteractive,
    });
    if (!chosenStorage) return cancelledResult(selectedFramework, defaultStorage, pm);
    selectedStorage = chosenStorage;
  }

  const finalStorage: StorageProviderId | undefined =
    explicitStorage ??
    (selectedStorage !== defaultStorage && selectedStorage !== 'custom' ? selectedStorage : undefined);
  const rec = resolveArchitecture(detected, { ...prelimOverrides, storage: finalStorage });
  const reportedStorage = mapStorageToInitStorage(rec.storage);
  const depPlan = planDependencies(detected, rec, pm);
  const packages = depPlan.toInstall;
  const installCommand =
    depPlan.installCommand || buildInstallCommand(pm, packages.length > 0 ? packages : ['img-upload-kit']);

  let shouldInstall = opts.install;
  if (shouldInstall === undefined) {
    const mode = await promptSelect<'install' | 'print'>({
      message: `Install dependencies now? (${installCommand})`,
      options: [
        { value: 'install', label: `Yes — run "${installCommand}" now`, hint: 'installs selected framework & storage packages automatically' },
        { value: 'print', label: 'No — show install command & starter imports only', hint: 'zero disk changes' },
      ],
      initialValue: nonInteractive || Boolean(input.isTTY && output.isTTY) ? 'install' : 'print',
      input,
      output,
      nonInteractive,
    });
    if (!mode) return cancelledResult(selectedFramework, selectedStorage, pm, packages, installCommand);
    shouldInstall = mode === 'install';
  }

  let installed = false;
  if (shouldInstall && packages.length > 0 && !opts.dryRun) {
    if (await ensurePackageJson(cwd)) renderCliStep('Initialized project', 'created package.json', output);
    renderCliStep('Installing packages', installCommand, output);
    await (opts.execInstall ?? defaultExecInstall)(pm, packages, cwd);
    installed = true;
  } else if (shouldInstall && opts.dryRun) {
    renderCliStep('Dry run', `would run "${installCommand}"`, output);
  }

  let scaffoldedFiles: string[] | undefined;
  if (opts.scaffold) {
    const planned = await buildScaffoldPlan(detected, rec, depPlan);
    const writeRes = await applyFileWrites(cwd, planned, { dryRun: Boolean(opts.dryRun) });
    scaffoldedFiles = writeRes.written;
    if (writeRes.written.length > 0) {
      renderCliStep(opts.dryRun ? 'Dry run scaffold' : 'Scaffolded files', writeRes.written.join(', '), output);
    }
  }

  const snippetLines = buildStarterSnippet(
    selectedFramework,
    reportedStorage,
    rec.storageCapability.displayName,
  );
  const c = createAnsiPalette(Boolean(output.isTTY));
  renderCliNote(
    'Quick Start Imports',
    [c.brightCyan(`$ ${installCommand}`), '', ...snippetLines.map((l) => c.green(l))],
    output,
  );
  renderCliOutro(
    installed
      ? `Installed ${packages.join(', ')} for ${selectedFramework}!`
      : opts.dryRun
        ? 'Dry run complete (no files or packages were modified).'
        : 'Ready! Run "npx img-upload-kit@latest init --yes" to install dependencies.',
    output,
  );

  return {
    cancelled: false,
    framework: selectedFramework,
    storage: reportedStorage,
    pm,
    packages,
    installCommand,
    installed,
    dryRun: Boolean(opts.dryRun),
    ...(scaffoldedFiles ? { scaffoldedFiles } : {}),
  };
}
