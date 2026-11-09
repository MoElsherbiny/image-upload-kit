import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildInstallCommand,
  detectProjectEnvironment,
  promptSelect,
  resolvePackagesToInstall,
  runCli,
  runInteractiveInit,
} from '../src/cli';

function createMockTtyStreams() {
  const input = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  input.isTTY = true;
  input.setRawMode = vi.fn();

  const chunks: string[] = [];
  const output = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    getOutput: () => string;
  };
  output.isTTY = true;
  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')));
  output.getOutput = () => chunks.join('');

  return { input, output };
}

describe('CLI interactive framework & storage setup (init / tui)', () => {
  const tempDirs: string[] = [];

  async function makeTempProject(pkgJson?: Record<string, unknown>, lockfile?: string) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-cli-init-'));
    tempDirs.push(dir);
    if (pkgJson) {
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');
    }
    if (lockfile) {
      await fs.writeFile(path.join(dir, lockfile), '', 'utf8');
    }
    return dir;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) await fs.rm(d, { recursive: true, force: true });
    }
  });

  it('navigates options with arrow keys and confirms with Enter in promptSelect', async () => {
    const { input, output } = createMockTtyStreams();

    const selectPromise = promptSelect({
      message: 'Select your framework:',
      options: [
        { value: 'react', label: 'React / Next.js' },
        { value: 'vue', label: 'Vue 3 / Nuxt 4' },
        { value: 'angular', label: 'Angular 17+' },
      ],
      initialValue: 'react',
      input,
      output,
    });

    // Press Down Arrow (\x1b[B) -> moves to 'vue', then Enter (\r)
    input.write('\x1b[B');
    input.write('\r');

    const chosen = await selectPromise;
    expect(chosen).toBe('vue');
    expect(output.getOutput()).toContain('Vue 3 / Nuxt 4');
  });

  it('supports number key shortcuts and Escape cancellation in promptSelect', async () => {
    const { input, output } = createMockTtyStreams();

    const selectPromise = promptSelect({
      message: 'Pick one:',
      options: [
        { value: 'react', label: 'React' },
        { value: 'vue', label: 'Vue' },
        { value: 'angular', label: 'Angular' },
      ],
      input,
      output,
    });

    // Press '3' to highlight Angular, then Enter
    input.write('3');
    input.write('\r');
    expect(await selectPromise).toBe('angular');

    // Escape cancels and returns null
    const cancelStreams = createMockTtyStreams();
    const cancelPromise = promptSelect({
      message: 'Cancel test:',
      options: [{ value: 'react', label: 'React' }],
      input: cancelStreams.input,
      output: cancelStreams.output,
    });
    cancelStreams.input.write('\x1b');
    expect(await cancelPromise).toBeNull();
  });

  it('detects project framework and package manager from package.json and lockfiles', async () => {
    const nuxtDir = await makeTempProject(
      { dependencies: { nuxt: '^4.0.0', vue: '^3.5.0' } },
      'pnpm-lock.yaml',
    );
    const env = await detectProjectEnvironment(nuxtDir);
    expect(env.pm).toBe('pnpm');
    expect(env.framework).toBe('vue');
    expect(env.detectedFrameworkName).toBe('Nuxt / Vue');
    expect(env.installedPackages.has('vue')).toBe(true);

    // Corepack packageManager field & monorepo parent lockfile detection:
    const monoRoot = await makeTempProject({ private: true }, 'yarn.lock');
    const subApp = path.join(monoRoot, 'apps', 'web');
    await fs.mkdir(subApp, { recursive: true });
    await fs.writeFile(
      path.join(subApp, 'package.json'),
      JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }),
      'utf8',
    );
    const monoEnv = await detectProjectEnvironment(subApp);
    expect(monoEnv.pm).toBe('yarn');
    expect(monoEnv.framework).toBe('react');
    expect(monoEnv.detectedFrameworkName).toBe('Next.js / React');
  });

  it('resolves exact packages for each framework and storage choice', () => {
    // Vue already installed + S3 storage -> installs img-upload-kit, sharp, @aws-sdk/client-s3
    const vueS3 = resolvePackagesToInstall('vue', 's3', new Set(['vue']));
    expect(vueS3).toEqual(['img-upload-kit', 'sharp', '@aws-sdk/client-s3']);
    expect(buildInstallCommand('pnpm', vueS3)).toBe(
      'pnpm add img-upload-kit sharp @aws-sdk/client-s3',
    );

    // React Native -> installs img-upload-kit + expo-image-picker (never sharp!)
    const rn = resolvePackagesToInstall('react-native', 'local', new Set(['react', 'react-native']));
    expect(rn).toEqual(['img-upload-kit', 'expo-image-picker']);
    expect(rn).not.toContain('sharp');
  });

  it('runs interactive init wizard end-to-end and executes package installation', async () => {
    const dir = await makeTempProject({ dependencies: { react: '^19.0.0' } });
    const { input, output } = createMockTtyStreams();
    const execInstall = vi.fn().mockResolvedValue(undefined);

    const initPromise = runInteractiveInit({
      cwd: dir,
      pm: 'npm',
      input,
      output,
      execInstall,
    });

    // Step 1 (Framework): Down arrow -> Vue, Enter
    setTimeout(() => input.write('\x1b[B\r'), 10);
    // Step 2 (Storage): Down arrow -> S3, Enter
    setTimeout(() => input.write('\x1b[B\r'), 25);
    // Step 3 (Install now?): Enter (default: 'install')
    setTimeout(() => input.write('\r'), 40);

    const result = await initPromise;
    expect(result.cancelled).toBe(false);
    expect(result.framework).toBe('vue');
    expect(result.storage).toBe('s3');
    expect(result.installed).toBe(true);
    expect(result.packages).toEqual(['img-upload-kit', 'vue', 'sharp', '@aws-sdk/client-s3']);
    expect(execInstall).toHaveBeenCalledWith(
      'npm',
      ['img-upload-kit', 'vue', 'sharp', '@aws-sdk/client-s3'],
      dir,
    );
  });

  it('supports CLI subcommand "init --yes --no-install", shorthand aliases, and top-level npx flags', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCli(['init', '--framework', 'angular', '--storage', 'supabase', '--yes', '--no-install']);
    expect(writeSpy).toHaveBeenCalled();

    writeSpy.mockClear();
    await runCli(['--framework', 'nextjs', '--storage', 'r2', '--yes', '--no-install']);
    expect(writeSpy).toHaveBeenCalled();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['init', '--help']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--framework'));
  });

  it('auto-installs packages when --yes is passed without --no-install', async () => {
    const dir = await makeTempProject({ dependencies: { vue: '^3.5.0' } });
    const { input, output } = createMockTtyStreams();
    const execInstall = vi.fn().mockResolvedValue(undefined);

    const result = await runInteractiveInit({
      cwd: dir,
      pm: 'npm',
      yes: true,
      input,
      output,
      execInstall,
    });

    expect(result.cancelled).toBe(false);
    expect(result.framework).toBe('vue');
    expect(result.storage).toBe('local');
    expect(result.installed).toBe(true);
    expect(execInstall).toHaveBeenCalledWith(
      'npm',
      ['img-upload-kit', 'sharp'],
      dir,
    );
  });
});
