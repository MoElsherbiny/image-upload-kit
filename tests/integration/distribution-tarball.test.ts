import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = path.join(rootDir, 'dist');
const binPath = path.join(distDir, 'bin.js');
const hasDist =
  existsSync(path.join(distDir, 'index.js')) &&
  existsSync(path.join(distDir, 'index.cjs')) &&
  existsSync(binPath);

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  types?: string;
  exports?: Record<string, unknown>;
  typesVersions?: Record<string, Record<string, string[]>>;
}

function collectDeclarationTargets(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    if (node.endsWith('.d.ts') || node.endsWith('.d.cts')) out.push(node);
  } else if (node && typeof node === 'object') {
    for (const val of Object.values(node as Record<string, unknown>)) {
      collectDeclarationTargets(val, out);
    }
  }
  return out;
}

describe.skipIf(!hasDist)('Distribution, Dual ESM/CJS & CLI Binary Verification', () => {
  let fixtureDir: string;

  beforeAll(async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-dist-cli-'));
    await fs.writeFile(
      path.join(fixtureDir, 'package.json'),
      JSON.stringify(
        {
          name: 'fixture-app',
          private: true,
          dependencies: {
            next: '15.0.0',
            react: '19.0.0',
            'react-dom': '19.0.0',
            'img-upload-kit': '^2.2.5',
            sharp: '^0.35.0',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
  });

  afterAll(async () => {
    if (fixtureDir) {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  const subpaths: Array<{
    name: string;
    esm: string;
    cjs: string;
    expectedExports: string[];
  }> = [
    { name: '.', esm: 'index.js', cjs: 'index.cjs', expectedExports: ['STANDARD_PRESETS', 'defineUploadPresets'] },
    { name: './client', esm: 'client.js', cjs: 'client.cjs', expectedExports: ['uploadAsset', 'createClientResizeTransform'] },
    { name: './server', esm: 'server.js', cjs: 'server.cjs', expectedExports: ['createImageUploader', 'createUploadHttpHandler'] },
    { name: './server/handler', esm: 'server-handler.js', cjs: 'server-handler.cjs', expectedExports: ['createUploadHttpHandler', 'signUploadToken'] },
    { name: './storage', esm: 'storage.js', cjs: 'storage.cjs', expectedExports: ['createLocalFsStorageAdapter', 'createMemoryStorageAdapter'] },
    { name: './blur', esm: 'blur.js', cjs: 'blur.cjs', expectedExports: ['blurService', 'BlurService'] },
    { name: './cli', esm: 'cli.js', cjs: 'cli.cjs', expectedExports: ['runCli', 'runDoctor'] },
  ];

  it('loads all core subpaths cleanly via ESM import() and CJS require()', async () => {
    const requireDist = createRequire(path.join(distDir, 'index.cjs'));

    for (const entry of subpaths) {
      const esmMod = (await import(pathToFileURL(path.join(distDir, entry.esm)).href)) as Record<
        string,
        unknown
      >;
      const cjsMod = requireDist(`./${entry.cjs}`) as Record<string, unknown>;

      for (const symbol of entry.expectedExports) {
        expect(esmMod[symbol], `ESM ${entry.name} missing ${symbol}`).toBeDefined();
        expect(cjsMod[symbol], `CJS ${entry.name} missing ${symbol}`).toBeDefined();
      }
    }
  });

  it('executes dist/bin.js cleanly for --help, config, and doctor in a fixture project', () => {
    const helpOut = execFileSync(process.execPath, [binPath, '--help'], {
      cwd: fixtureDir,
      encoding: 'utf8',
    });
    expect(helpOut).toContain('img-upload-kit');

    const configOut = execFileSync(process.execPath, [binPath, 'config', '--cwd', fixtureDir], {
      cwd: fixtureDir,
      encoding: 'utf8',
    });
    const parsedConfig = JSON.parse(configOut) as { resolved?: { storage?: string } };
    expect(parsedConfig.resolved?.storage).toBe('local');

    const doctorOut = execFileSync(
      process.execPath,
      [binPath, 'doctor', '--json', '--cwd', fixtureDir],
      {
        cwd: fixtureDir,
        encoding: 'utf8',
      },
    );
    const parsedDoctor = JSON.parse(doctorOut) as { ok?: boolean; issues?: unknown[] };
    expect(parsedDoctor.ok).toBe(true);
    expect(Array.isArray(parsedDoctor.issues)).toBe(true);
  });

  it('verifies zero runtime dependencies and existence of all declared .d.ts / .d.cts files', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
    ) as PackageJsonShape;

    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);

    const decls = new Set<string>();
    if (pkg.types) decls.add(pkg.types);
    for (const target of collectDeclarationTargets(pkg.exports)) decls.add(target);
    for (const target of collectDeclarationTargets(pkg.typesVersions)) decls.add(target);

    expect(decls.size).toBeGreaterThan(10);
    for (const relPath of decls) {
      expect(existsSync(path.join(rootDir, relPath)), `Missing declaration file: ${relPath}`).toBe(
        true,
      );
    }
  });
});
