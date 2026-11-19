import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENTS_MARKER_END,
  AGENTS_MARKER_START,
  buildRedactedConfigSnapshot,
  runAgentsCommand,
  runCli,
  runDoctor,
  runInteractiveInit,
  validateProjectIntegration,
} from '../../src/cli';

describe('CLI commands: doctor, validate, agents, config & init --dry-run/--scaffold', () => {
  const tempDirs: string[] = [];

  async function makeProject(
    pkg: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-7b-cmd-'));
    tempDirs.push(dir);
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    }
    return dir;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) await fs.rm(d, { recursive: true, force: true });
    }
  });

  it('doctor diagnoses Sharp in incompatible runtime & public env secret leaks', async () => {
    const dir = await makeProject(
      { dependencies: { react: '19.0.0', sharp: '^0.35.0' }, devDependencies: { vite: '^6.0.0' } },
      { '.env.example': 'VITE_AWS_SECRET_ACCESS_KEY=oops\n' },
    );

    const report = await runDoctor({ cwd: dir });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === 'SHARP_INCOMPATIBLE_RUNTIME')).toBe(true);
    expect(report.issues.some((i) => i.code === 'PUBLIC_ENV_SECRET_LEAK')).toBe(true);

    const validation = await validateProjectIntegration(dir);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('doctor --fix safely merges missing env keys and creates/updates AGENTS.md', async () => {
    const dir = await makeProject(
      {
        dependencies: {
          next: '15.0.0',
          react: '19.0.0',
          'react-dom': '19.0.0',
          'img-upload-kit': '^2.2.5',
          sharp: '^0.35.0',
          '@aws-sdk/client-s3': '^3.0.0',
        },
      },
      {
        '.env.example': 'AWS_REGION=us-east-1\n',
        'AGENTS.md': '# Team Agent Guide\n\nCustom user rule.\n',
      },
    );

    const before = await runDoctor({ cwd: dir });
    expect(before.issues.some((i) => i.code === 'MISSING_ENV_KEYS')).toBe(true);
    expect(before.issues.some((i) => i.code === 'OUTDATED_AGENTS_MD')).toBe(true);

    const fixed = await runDoctor({ cwd: dir, fix: true });
    expect(fixed.ok).toBe(true);
    expect(fixed.appliedFixes.length).toBe(2);

    const envAfter = await fs.readFile(path.join(dir, '.env.example'), 'utf8');
    expect(envAfter).toContain('AWS_REGION=us-east-1');
    expect(envAfter).toContain('AWS_S3_BUCKET=');

    const agentsAfter = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agentsAfter).toContain('Custom user rule.');
    expect(agentsAfter).toContain(AGENTS_MARKER_START);
    expect(agentsAfter).toContain(AGENTS_MARKER_END);
  });

  it('agents command creates AGENTS.md and requires --update for existing files', async () => {
    const dir = await makeProject({ dependencies: { nuxt: '4.0.0', vue: '3.5.0' } });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const created = await runAgentsCommand({ cwd: dir });
    expect(created.written).toBe(true);

    // Without --update, does not overwrite existing file
    const skipped = await runAgentsCommand({ cwd: dir, update: false });
    expect(skipped.written).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('--update'));
  });

  it('config command outputs redacted snapshot and NEVER leaks .env secret values', async () => {
    const dir = await makeProject(
      { dependencies: { next: '15.0.0', '@aws-sdk/client-s3': '^3.0.0' } },
      {
        '.env': 'AWS_SECRET_ACCESS_KEY=TOP_SECRET_DO_NOT_LEAK\n',
        '.env.example': 'AWS_REGION=us-east-1\nAWS_SECRET_ACCESS_KEY=placeholder\n',
      },
    );

    const snapshot = await buildRedactedConfigSnapshot(dir);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('TOP_SECRET_DO_NOT_LEAK');
    expect(snapshot.resolved.storage).toBe('s3');
    const secretEntry = snapshot.envTemplates[0]?.keys.find(
      (k) => k.key === 'AWS_SECRET_ACCESS_KEY',
    );
    expect(secretEntry?.redacted).toBe(true);
  });

  it('supports unified validate (project mode vs -f manifest mode) and non-interactive CLI subcommands', async () => {
    const dir = await makeProject(
      { dependencies: { next: '15.0.0', react: '19.0.0', 'react-dom': '19.0.0', 'img-upload-kit': '^2.2.5', sharp: '^0.35.0' } },
      {
        'src/blur-hashes.json': JSON.stringify({
          version: '2.0',
          generatedAt: '2026-01-01T00:00:00.000Z',
          totalImages: 0,
          hashes: {},
        }),
      },
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Unified validate without -f validates project + blur manifest
    await runCli(['validate', '--cwd', dir]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Project integration is valid'));

    // Legacy validate -f validates blur manifest directly
    logSpy.mockClear();
    await runCli(['validate', '-f', path.join(dir, 'src/blur-hashes.json')]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Manifest is valid'));

    // config & doctor --json via runCli
    logSpy.mockClear();
    await runCli(['config', '--cwd', dir]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"storage": "local"'));

    logSpy.mockClear();
    await runCli(['doctor', '--json', '--cwd', dir]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"ok": true'));
  });

  it('supports init --yes --dry-run --scaffold without modifying disk or running install', async () => {
    const dir = await makeProject({ dependencies: { next: '15.0.0', react: '19.0.0' } });
    const execInstall = vi.fn().mockResolvedValue(undefined);
    const input = new PassThrough();
    const output = new PassThrough();

    const result = await runInteractiveInit({
      cwd: dir,
      framework: 'react',
      storage: 's3',
      pm: 'pnpm',
      yes: true,
      dryRun: true,
      scaffold: true,
      input,
      output,
      execInstall,
    });

    expect(result.cancelled).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.installed).toBe(false);
    expect(execInstall).not.toHaveBeenCalled();
    expect(result.scaffoldedFiles).toContain('app/api/upload/route.ts');
    expect(result.scaffoldedFiles).toContain('src/lib/upload-storage.ts');
    await expect(fs.access(path.join(dir, 'app/api/upload/route.ts'))).rejects.toThrow();
  });
});
