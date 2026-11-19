import fs from 'node:fs/promises';
import path from 'node:path';
import { detectPackageManager } from '../package-managers/pmDetector';
import type { MonorepoInfo, ProjectDetectionReport } from '../types/detection';
import { inspectEnvTemplateFiles } from './envInspector';
import {
  detectBackendLayer,
  detectCdnAndAuth,
  detectFrontendLayer,
  detectStorageLayer,
} from './layerDetectors';

interface MinimalPackageJson {
  packageManager?: string;
  workspaces?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const KNOWN_CONFIG_FILES = [
  'next.config.ts',
  'next.config.mjs',
  'next.config.js',
  'nuxt.config.ts',
  'nuxt.config.js',
  'angular.json',
  'app.json',
  'vite.config.ts',
  'vite.config.js',
  'wrangler.toml',
  'wrangler.json',
  'wrangler.jsonc',
  'firebase.json',
  'serverless.yml',
  'template.yaml',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'nx.json',
  'tsconfig.json',
  'AGENTS.md',
  'src/blur-hashes.json',
] as const;

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function detectMonorepo(
  cwd: string,
  pkgWorkspaces: unknown,
  rootFiles: ReadonlySet<string>,
): Promise<MonorepoInfo> {
  if (rootFiles.has('turbo.json')) return { isMonorepo: true, tool: 'turbo', workspaceRoot: cwd };
  if (rootFiles.has('nx.json')) return { isMonorepo: true, tool: 'nx', workspaceRoot: cwd };
  if (rootFiles.has('pnpm-workspace.yaml')) {
    return { isMonorepo: true, tool: 'pnpm', workspaceRoot: cwd };
  }
  if (Array.isArray(pkgWorkspaces) || (pkgWorkspaces && typeof pkgWorkspaces === 'object')) {
    const tool = (await fileExists(path.join(cwd, 'yarn.lock'))) ? 'yarn' : 'npm';
    return { isMonorepo: true, tool, workspaceRoot: cwd };
  }

  // Check up to 2 parent directories for workspace root markers
  let parent = path.dirname(cwd);
  for (let depth = 0; depth < 2; depth += 1) {
    if (parent === cwd) break;
    if (await fileExists(path.join(parent, 'pnpm-workspace.yaml'))) {
      return { isMonorepo: true, tool: 'pnpm', workspaceRoot: parent };
    }
    if (await fileExists(path.join(parent, 'turbo.json'))) {
      return { isMonorepo: true, tool: 'turbo', workspaceRoot: parent };
    }
    if (await fileExists(path.join(parent, 'nx.json'))) {
      return { isMonorepo: true, tool: 'nx', workspaceRoot: parent };
    }
    const nextParent = path.dirname(parent);
    if (nextParent === parent) break;
    parent = nextParent;
  }

  return { isMonorepo: false, tool: 'none' };
}

export async function detectProject(
  cwd: string = process.cwd(),
): Promise<ProjectDetectionReport> {
  const resolvedCwd = path.resolve(cwd);
  const packages = new Set<string>();
  let hasPackageJson = false;
  let declaredPm: string | undefined;
  let pkgWorkspaces: unknown;

  try {
    const raw = await fs.readFile(path.join(resolvedCwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as MinimalPackageJson;
    hasPackageJson = true;
    declaredPm = pkg.packageManager;
    pkgWorkspaces = pkg.workspaces;
    for (const group of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
      if (group) {
        for (const dep of Object.keys(group)) packages.add(dep);
      }
    }
  } catch {
    // Missing or unreadable package.json
  }

  const presentFiles = new Set<string>();
  await Promise.all(
    KNOWN_CONFIG_FILES.map(async (rel) => {
      if (await fileExists(path.join(resolvedCwd, rel))) {
        presentFiles.add(rel);
      }
    }),
  );

  const envFiles = await inspectEnvTemplateFiles(resolvedCwd);
  const envKeys = new Set<string>();
  for (const envFile of envFiles) {
    for (const key of envFile.keys) envKeys.add(key);
  }

  const signals = { packages, files: presentFiles, envKeys };
  const frontend = detectFrontendLayer(signals);
  const backend = detectBackendLayer(signals, frontend.detected);
  const { layer: storage, ambiguous: ambiguousStorage } = detectStorageLayer(signals);
  const { cdn, auth } = detectCdnAndAuth(signals);
  const packageManager = await detectPackageManager(resolvedCwd, declaredPm);
  const monorepo = await detectMonorepo(resolvedCwd, pkgWorkspaces, presentFiles);

  return {
    cwd: resolvedCwd,
    packageManager,
    hasPackageJson,
    installedPackages: Array.from(packages).sort(),
    frontend,
    backend,
    storage,
    cdn,
    auth,
    hasDocker:
      presentFiles.has('Dockerfile') ||
      presentFiles.has('docker-compose.yml') ||
      presentFiles.has('docker-compose.yaml'),
    monorepo,
    envFiles,
    hasAgentsMd: presentFiles.has('AGENTS.md'),
    hasBlurManifest: presentFiles.has('src/blur-hashes.json'),
    typescript: presentFiles.has('tsconfig.json') || packages.has('typescript'),
    ambiguousStorage,
  };
}
