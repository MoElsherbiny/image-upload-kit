import fs from 'node:fs/promises';
import path from 'node:path';
import type { PackageManagerName } from '../types/detection';

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function detectLockfilePm(dir: string): Promise<PackageManagerName | null> {
  if (
    (await fileExists(path.join(dir, 'pnpm-lock.yaml'))) ||
    (await fileExists(path.join(dir, 'pnpm-workspace.yaml')))
  ) {
    return 'pnpm';
  }
  if (await fileExists(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (
    (await fileExists(path.join(dir, 'bun.lockb'))) ||
    (await fileExists(path.join(dir, 'bun.lock')))
  ) {
    return 'bun';
  }
  if (await fileExists(path.join(dir, 'package-lock.json'))) return 'npm';
  return null;
}

export function parsePackageManagerField(raw?: string): PackageManagerName | null {
  const pmSpec = raw?.split('@')[0]?.trim().toLowerCase();
  if (pmSpec === 'pnpm' || pmSpec === 'yarn' || pmSpec === 'bun' || pmSpec === 'npm') {
    return pmSpec;
  }
  return null;
}

export async function detectPackageManager(
  cwd: string,
  declaredPackageManager?: string,
): Promise<PackageManagerName> {
  const declared = parsePackageManagerField(declaredPackageManager);
  if (declared) return declared;

  const dirs = [cwd, path.dirname(cwd), path.dirname(path.dirname(cwd))];
  for (const dir of dirs) {
    const found = await detectLockfilePm(dir);
    if (found) return found;
  }

  const ua = process.env.npm_config_user_agent ?? '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'npm';
}

export function formatInstallCommand(
  pm: PackageManagerName,
  packages: readonly string[],
): string {
  if (packages.length === 0) return '';
  const list = packages.join(' ');
  if (pm === 'pnpm') return `pnpm add ${list}`;
  if (pm === 'yarn') return `yarn add ${list}`;
  if (pm === 'bun') return `bun add ${list}`;
  return `npm i ${list}`;
}
