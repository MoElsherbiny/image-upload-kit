import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENTS_MARKER_END,
  AGENTS_MARKER_START,
  type DoctorReport,
  type RedactedConfigSnapshot,
  runInteractiveInit,
} from '../../src/cli';
import { solidImage } from '../helpers/imageFixtures';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binPath = path.join(rootDir, 'dist', 'bin.js');
const hasBin = existsSync(binPath);

interface CliRunOutput {
  code: number;
  stdout: string;
  stderr: string;
}

function execBin(args: string[], cwd: string): Promise<CliRunOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [binPath, ...args],
      { cwd, encoding: 'utf8', timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error);
          return;
        }
        resolve({
          code: error && typeof error.code === 'number' ? error.code : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

describe.skipIf(!hasBin)('E2E CLI Workflows (dist/bin.js)', () => {
  const tempDirs: string[] = [];

  async function makeTempProject(
    pkg: Record<string, unknown>,
    files: Record<string, string> = {},
  ): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-e2e-cli-'));
    tempDirs.push(dir);
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = path.join(dir, relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
    }
    return dir;
  }

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('runs full Next.js + AWS S3 lifecycle: init --scaffold -> validate -> redacted config -> agents --update', async () => {
    const liveSecret = 'SUPER_SECRET_AWS_LIVE_VALUE_999888';
    const baseDeps = {
      next: '^15.1.0',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      '@aws-sdk/client-s3': '^3.700.0',
      'img-upload-kit': '^2.2.5',
      sharp: '^0.35.0',
    };
    const dir = await makeTempProject(
      { name: 'nextjs-s3-e2e', private: true, dependencies: baseDeps },
      { '.env': `AWS_SECRET_ACCESS_KEY=${liveSecret}\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n` },
    );

    const initRes = await execBin(['init', '--yes', '--no-install', '--scaffold'], dir);
    expect(initRes.code).toBe(0);

    const [routeContent, storageContent, envExampleContent, agentsInitial] = await Promise.all([
      fs.readFile(path.join(dir, 'app/api/upload/route.ts'), 'utf8'),
      fs.readFile(path.join(dir, 'src/lib/upload-storage.ts'), 'utf8'),
      fs.readFile(path.join(dir, '.env.example'), 'utf8'),
      fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8'),
    ]);
    expect(routeContent).toContain('createUploadHttpHandler');
    expect(storageContent).toContain('createS3StorageAdapter');
    expect(envExampleContent).toContain('AWS_S3_BUCKET=');
    expect(agentsInitial).toContain(AGENTS_MARKER_START);
    expect(agentsInitial).toContain(AGENTS_MARKER_END);

    const validateRes = await execBin(['validate', '--cwd', dir], dir);
    expect(validateRes.code).toBe(0);
    expect(validateRes.stdout).toContain('Project integration is valid');

    const configRes = await execBin(['config', '--cwd', dir], dir);
    expect(configRes.code).toBe(0);
    expect(configRes.stdout).not.toContain(liveSecret);
    expect(configRes.stderr).not.toContain(liveSecret);

    const snapshot = JSON.parse(configRes.stdout) as RedactedConfigSnapshot;
    expect(snapshot.resolved.backend).toBe('nextjs-node');
    expect(snapshot.resolved.storage).toBe('s3');
    const s3SecretKey = snapshot.envTemplates
      .find((f) => f.fileName === '.env.example')
      ?.keys.find((k) => k.key === 'AWS_SECRET_ACCESS_KEY');
    expect(s3SecretKey?.redacted).toBe(true);

    // Add custom notes outside markers & Clerk auth so managed section updates without losing notes
    await fs.writeFile(
      path.join(dir, 'AGENTS.md'),
      `# Custom Team Header\nKeep strict domain boundaries.\n\n${agentsInitial}\n## Footer\nNever commit credentials.\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'nextjs-s3-e2e', private: true, dependencies: { ...baseDeps, '@clerk/nextjs': '^6.0.0' } }, null, 2),
      'utf8',
    );

    const agentsNoUpdate = await execBin(['agents', '--cwd', dir], dir);
    expect(agentsNoUpdate.code).toBe(0);
    expect(agentsNoUpdate.stdout).toContain('--update');

    const agentsUpdate = await execBin(['agents', '--update', '--cwd', dir], dir);
    expect(agentsUpdate.code).toBe(0);
    expect(agentsUpdate.stdout).toContain('Updated AGENTS.md');

    const agentsFinal = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agentsFinal).toContain('Keep strict domain boundaries.');
    expect(agentsFinal).toContain('Never commit credentials.');
    expect(agentsFinal).toContain('clerk');
  }, 45_000);

  it('runs doctor diagnosis & --fix on Vue + Nuxt and flags Cloudflare Sharp & NEXT_PUBLIC secret leaks', async () => {
    const nuxtDir = await makeTempProject(
      {
        name: 'nuxt-vue-e2e',
        private: true,
        dependencies: { nuxt: '^4.0.0', vue: '^3.5.0', '@aws-sdk/client-s3': '^3.700.0', 'img-upload-kit': '^2.2.5', sharp: '^0.35.0' },
      },
      { '.env.example': 'NUXT_PORT=3000\n' },
    );

    const beforeRes = await execBin(['doctor', '--json', '--cwd', nuxtDir], nuxtDir);
    expect(beforeRes.code).toBe(0);
    const beforeReport = JSON.parse(beforeRes.stdout) as DoctorReport;
    expect(beforeReport.issues.some((i) => i.code === 'MISSING_ENV_KEYS' && i.fixable)).toBe(true);
    expect(beforeReport.issues.some((i) => i.code === 'MISSING_AGENTS_MD' && i.fixable)).toBe(true);

    const fixRes = await execBin(['doctor', '--fix', '--cwd', nuxtDir], nuxtDir);
    expect(fixRes.code).toBe(0);
    expect(fixRes.stdout).toContain('Fixed:');

    const mergedEnv = await fs.readFile(path.join(nuxtDir, '.env.example'), 'utf8');
    expect(mergedEnv).toContain('NUXT_PORT=3000');
    expect(mergedEnv).toContain('AWS_S3_BUCKET=');

    const [afterDoctor, afterValidate] = await Promise.all([
      execBin(['doctor', '--cwd', nuxtDir], nuxtDir),
      execBin(['validate', '--cwd', nuxtDir], nuxtDir),
    ]);
    expect(afterDoctor.code).toBe(0);
    expect(afterDoctor.stdout).toContain('Doctor: no issues found.');
    expect(afterValidate.code).toBe(0);
    expect(afterValidate.stdout).toContain('Project integration is valid');

    const cfDir = await makeTempProject(
      { name: 'cf-workers-broken', private: true, dependencies: { sharp: '^0.35.0', 'img-upload-kit': '^2.2.5' }, devDependencies: { wrangler: '^3.90.0' } },
      { 'wrangler.toml': 'name = "upload-edge"\ncompatibility_date = "2026-01-01"\n', '.env.example': 'NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY=exposed\n' },
    );

    const cfDoctor = await execBin(['doctor', '--json', '--cwd', cfDir], cfDir);
    expect(cfDoctor.code).toBe(1);
    const cfReport = JSON.parse(cfDoctor.stdout) as DoctorReport;
    expect(cfReport.ok).toBe(false);
    expect(cfReport.issues.some((i) => i.code === 'PUBLIC_ENV_SECRET_LEAK' && i.severity === 'error')).toBe(true);
    expect(cfReport.issues.some((i) => i.code === 'SHARP_INCOMPATIBLE_RUNTIME' && i.severity === 'error')).toBe(true);
  }, 45_000);

  it('scaffolds frontend-only Vite React (no sharp) and Express + GCS honest custom StorageAdapter', async () => {
    const viteDir = await makeTempProject(
      { name: 'vite-react-spa', private: true, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { vite: '^6.0.0' } },
      { 'vite.config.ts': 'export default {};\n' },
    );

    const viteInit = await execBin(['init', '--yes', '--no-install', '--scaffold'], viteDir);
    expect(viteInit.code).toBe(0);
    expect(viteInit.stdout).not.toContain('sharp');
    const viteClientHelper = await fs.readFile(path.join(viteDir, 'src/lib/upload-client.ts'), 'utf8');
    expect(viteClientHelper).toContain('createClientResizeTransform');
    expect(existsSync(path.join(viteDir, 'src/lib/upload-storage.ts'))).toBe(false);

    const gcsDir = await makeTempProject({
      name: 'express-gcs-api',
      private: true,
      dependencies: { express: '^4.21.0', '@google-cloud/storage': '^7.14.0' },
    });

    const programmatic = await runInteractiveInit({
      cwd: gcsDir,
      yes: true,
      install: false,
      dryRun: true,
      input: new PassThrough(),
      output: new PassThrough(),
    });
    expect(programmatic.storage).toBe('custom');

    const gcsInit = await execBin(['init', '--yes', '--no-install', '--scaffold'], gcsDir);
    expect(gcsInit.code).toBe(0);
    expect(gcsInit.stdout).toContain('Google Cloud Storage (Custom StorageAdapter)');

    const gcsStorageFile = await fs.readFile(path.join(gcsDir, 'src/lib/upload-storage.ts'), 'utf8');
    expect(gcsStorageFile).toContain('@google-cloud/storage');
    expect(gcsStorageFile).toContain('StorageAdapter');
    expect(gcsStorageFile).not.toContain('createLocalFsStorageAdapter');
    expect(existsSync(path.join(gcsDir, 'src/server/upload-handler.ts'))).toBe(true);
  }, 45_000);

  it('executes full Blur Manifest lifecycle: generate -> validate -f -> inspect -> sync -> cleanup -> health', async () => {
    const dir = await makeTempProject({ name: 'blur-manifest-e2e', private: true });
    const imagesDir = path.join(dir, 'public', 'images');
    const manifestPath = path.join(dir, 'src', 'blur-hashes.json');
    await fs.mkdir(imagesDir, { recursive: true });

    const [heroBuf, cardBuf] = await Promise.all([
      solidImage(64, 48, 'png', '#2266dd'),
      solidImage(48, 48, 'png', '#dd5522'),
    ]);
    await Promise.all([
      fs.writeFile(path.join(imagesDir, 'hero.png'), heroBuf),
      fs.writeFile(path.join(imagesDir, 'card.png'), cardBuf),
    ]);

    const genRes = await execBin(['generate', '-d', imagesDir, '-o', manifestPath], dir);
    expect(genRes.code).toBe(0);
    expect(genRes.stdout).toContain('total: 2, processed: 2');

    const valRes = await execBin(['validate', '-f', manifestPath], dir);
    expect(valRes.code).toBe(0);
    expect(valRes.stdout).toContain('Manifest is valid (2 entries).');

    const inspectRes = await execBin(['inspect', '/hero.png', '-f', manifestPath], dir);
    expect(inspectRes.code).toBe(0);
    const inspected = JSON.parse(inspectRes.stdout) as { key: string; width: number; height: number; variants: { hasMedium: boolean } };
    expect(inspected.key).toBe('/hero.png');
    expect(inspected.width).toBe(64);
    expect(inspected.height).toBe(48);
    expect(inspected.variants.hasMedium).toBe(true);

    await fs.unlink(path.join(imagesDir, 'card.png'));

    const syncRes = await execBin(['sync', '-d', imagesDir, '-f', manifestPath], dir);
    expect(syncRes.code).toBe(1);
    expect(syncRes.stdout).toContain('Out of sync: 0 missing, 1 orphaned.');

    const dryCleanup = await execBin(['cleanup', '-d', imagesDir, '-f', manifestPath, '--dry-run'], dir);
    expect(dryCleanup.code).toBe(0);
    expect(dryCleanup.stdout).toContain('[Dry Run] Would remove 1 orphaned entries.');
    const afterDry = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { hashes: Record<string, unknown> };
    expect(Object.keys(afterDry.hashes).length).toBe(2);

    const realCleanup = await execBin(['cleanup', '-d', imagesDir, '-f', manifestPath], dir);
    expect(realCleanup.code).toBe(0);
    expect(realCleanup.stdout).toContain('Removed 1 orphaned entries.');
    const afterReal = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { hashes: Record<string, unknown> };
    expect(Object.keys(afterReal.hashes)).toEqual(['/hero.png']);

    const healthRes = await execBin(['health', '-d', imagesDir, '-f', manifestPath], dir);
    expect(healthRes.code).toBe(0);
    expect(healthRes.stdout).toContain('coverage=100%');
  }, 45_000);
});
