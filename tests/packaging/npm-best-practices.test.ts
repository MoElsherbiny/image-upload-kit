import { exec } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execAsync = promisify(exec);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = path.join(rootDir, 'dist');
const hasDist =
  existsSync(path.join(distDir, 'index.js')) &&
  existsSync(path.join(distDir, 'index.cjs')) &&
  existsSync(path.join(distDir, 'index.d.ts')) &&
  existsSync(path.join(distDir, 'bin.js')) &&
  existsSync(path.join(distDir, 'styles.css'));

interface PackageJsonManifest {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  author?: string | { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: { type?: string; url?: string };
  bugs?: { url?: string };
  engines?: { node?: string };
  type?: string;
  sideEffects?: boolean | string[];
  publishConfig?: { access?: string; provenance?: boolean };
  files?: string[];
  keywords?: string[];
  scripts?: Record<string, string>;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface NpmPackFileEntry {
  path: string;
  size: number;
  mode: number;
}

interface NpmPackDryRunEntry {
  id: string;
  name: string;
  version: string;
  files: NpmPackFileEntry[];
}

const IGNORED_SCAN_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.pnpm-store',
]);

const BANNED_PLANNING_FILENAMES = new Set([
  'IMPLEMENTATION_PLAN.md',
  'TECHNICAL_ROADMAP.md',
  'RISK_REGISTER.md',
  'BASELINE.md',
  'RELEASE_READINESS.md',
  'IMPLEMENTATION_PROGRESS.md',
]);

function walkRepositoryFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_SCAN_DIRS.has(entry)) continue;
    const absPath = path.join(dir, entry);
    const stats = statSync(absPath);
    if (stats.isDirectory()) {
      walkRepositoryFiles(absPath, out);
    } else {
      out.push(path.relative(rootDir, absPath).replace(/\\/g, '/'));
    }
  }
  return out;
}

function readManifest(): PackageJsonManifest {
  const raw = readFileSync(path.join(rootDir, 'package.json'), 'utf8');
  return JSON.parse(raw) as PackageJsonManifest;
}

describe('npm production packaging & docs.npmjs.com best practices', () => {
  const pkg = readManifest();

  it('validates core package.json metadata, provenance, engines, and module fields', () => {
    expect(pkg.name).toBe('img-upload-kit');
    expect(pkg.name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect((pkg.name ?? '').length).toBeLessThanOrEqual(214);

    expect(pkg.version).toMatch(
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    );
    expect(typeof pkg.description).toBe('string');
    expect((pkg.description ?? '').trim().length).toBeGreaterThan(20);
    expect(pkg.license).toBe('MIT');

    const authorValid =
      typeof pkg.author === 'string'
        ? pkg.author.trim().length > 0
        : Boolean(pkg.author?.name);
    expect(authorValid).toBe(true);

    expect(pkg.repository?.type).toBe('git');
    expect(pkg.repository?.url).toMatch(/^git\+https:\/\/github\.com\/.+\.git$/);
    expect(pkg.bugs?.url).toMatch(/^https:\/\//);
    expect(pkg.homepage).toMatch(/^https:\/\//);

    expect(pkg.engines?.node).toBe('>=20.0.0');
    expect(pkg.type).toBe('module');
    expect(pkg.sideEffects).toEqual(['**/*.css']);
    expect(pkg.publishConfig).toEqual({
      access: 'public',
      provenance: true,
    });
  });

  it('enforces zero runtime dependencies, optional peerDependencies, CLI bin, scripts & keywords', () => {
    expect(pkg.dependencies).toEqual({});

    const peerNames = Object.keys(pkg.peerDependencies ?? {});
    expect(peerNames.length).toBeGreaterThan(0);
    for (const peerName of peerNames) {
      expect(
        pkg.peerDependenciesMeta?.[peerName]?.optional,
        `peerDependency "${peerName}" must be marked optional: true in peerDependenciesMeta`,
      ).toBe(true);
    }

    expect(pkg.bin?.['img-upload-kit']).toBe('dist/bin.js');

    const requiredKeywords = [
      'resumable-upload',
      'multipart-upload',
      'cloudflare-r2',
      's3-upload',
      'supabase-storage',
      'cli',
    ];
    for (const kw of requiredKeywords) {
      expect(pkg.keywords).toContain(kw);
    }

    const requiredScripts = [
      'test',
      'test:watch',
      'test:unit',
      'test:frameworks',
      'test:cli',
      'test:security',
      'test:integration',
      'test:e2e',
      'test:packaging',
      'check:lines',
      'check:dist',
      'check:pack',
    ];
    for (const scriptName of requiredScripts) {
      expect(typeof pkg.scripts?.[scriptName]).toBe('string');
    }
  });

  it('exposes ./package.json and places "types" first in every conditional exports object', () => {
    const exportsMap = pkg.exports ?? {};
    expect(exportsMap['./package.json']).toBe('./package.json');

    for (const [subpath, entryVal] of Object.entries(exportsMap)) {
      if (!entryVal || typeof entryVal !== 'object') continue;
      const entryRecord = entryVal as Record<string, unknown>;

      if ('types' in entryRecord) {
        expect(
          Object.keys(entryRecord)[0],
          `exports["${subpath}"] must list "types" condition first`,
        ).toBe('types');
      }

      for (const [condKey, condVal] of Object.entries(entryRecord)) {
        if (condVal && typeof condVal === 'object') {
          const condRecord = condVal as Record<string, unknown>;
          if ('types' in condRecord) {
            expect(
              Object.keys(condRecord)[0],
              `exports["${subpath}"]["${condKey}"] must list "types" condition first`,
            ).toBe('types');
          }
        }
      }
    }
  });

  it('enforces zero internal planning files across the entire repository', () => {
    expect(existsSync(path.join(rootDir, 'docs', 'engineering'))).toBe(false);

    const allFiles = walkRepositoryFiles(rootDir);
    expect(allFiles.length).toBeGreaterThan(20);

    const leakedPlanningFiles = allFiles.filter((relPath) => {
      const base = path.posix.basename(relPath);
      return (
        relPath.startsWith('docs/engineering/') ||
        base.toLowerCase().endsWith('.plan.md') ||
        BANNED_PLANNING_FILENAMES.has(base)
      );
    });

    expect(leakedPlanningFiles).toEqual([]);
  });

  describe.skipIf(!hasDist)('npm pack --dry-run --json tarball hygiene', () => {
    it(
      'packs all required runtime/type/doc artifacts and excludes source, tests, maps, scripts & env files',
      async () => {
        const { stdout: rawOutput } = await execAsync('npm pack --dry-run --json', {
          cwd: rootDir,
          encoding: 'utf8',
        });
        // npm <= 11 prints an array of entries; npm >= 12 prints an object keyed by package name.
        const jsonStart = rawOutput.search(/^[[{]/m);
        expect(jsonStart).toBeGreaterThanOrEqual(0);
        const closer = rawOutput[jsonStart] === '[' ? ']' : '}';
        const jsonEnd = rawOutput.lastIndexOf(closer);
        expect(jsonEnd).toBeGreaterThan(jsonStart);

        const raw = JSON.parse(rawOutput.slice(jsonStart, jsonEnd + 1)) as
          | NpmPackDryRunEntry[] | Record<string, NpmPackDryRunEntry>;
        const parsed = Array.isArray(raw) ? raw : Object.values(raw);
        expect(parsed.length).toBe(1);

        const packedPaths = parsed[0].files.map((f) => f.path.replace(/\\/g, '/'));
        const packedSet = new Set(packedPaths);

        expect(packedPaths.filter((p) => p.endsWith('.map'))).toEqual([]);
        expect(
          packedPaths.filter(
            (p) =>
              p.startsWith('src/') ||
              p.startsWith('tests/') ||
              p.startsWith('scripts/') ||
              p.startsWith('.github/') ||
              p.startsWith('docs/engineering/') ||
              /^\.env(?:$|\.)/i.test(path.posix.basename(p)),
          ),
        ).toEqual([]);

        const requiredTarballFiles = [
          'README.md',
          'LICENSE',
          'CHANGELOG.md',
          'SECURITY.md',
          'package.json',
          'dist/index.js',
          'dist/index.cjs',
          'dist/index.d.ts',
          'dist/bin.js',
          'dist/styles.css',
        ];
        for (const reqFile of requiredTarballFiles) {
          expect(packedSet.has(reqFile), `Expected tarball to contain "${reqFile}"`).toBe(true);
        }
      },
      30_000,
    );
  });
});
