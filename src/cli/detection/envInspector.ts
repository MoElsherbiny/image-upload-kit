import fs from 'node:fs/promises';
import path from 'node:path';
import type { EnvTemplateFileInfo } from '../types/detection';

/**
 * Strictly allowlisted template files. Secret-bearing `.env`, `.env.local`,
 * `.env.production`, etc. are NEVER read by the CLI.
 */
export const ALLOWED_ENV_TEMPLATE_FILES = [
  '.env.example',
  '.env.sample',
  '.env.template',
] as const;

const ENV_KEY_LINE_RE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/;

const PUBLIC_ENV_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'EXPO_PUBLIC_', 'NUXT_PUBLIC_'] as const;

const SENSITIVE_KEY_TOKENS = [
  'SECRET',
  'SERVICE_ROLE',
  'PRIVATE_KEY',
  'ACCESS_KEY_ID',
  'APPLICATION_KEY',
  'CONNECTION_STRING',
  'CREDENTIALS',
  'PASSWORD',
  'AUTH_TOKEN',
  'API_SECRET',
] as const;

export function extractEnvKeysOnly(rawContent: string): string[] {
  const keys = new Set<string>();
  for (const line of rawContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = ENV_KEY_LINE_RE.exec(trimmed);
    if (match?.[1]) {
      keys.add(match[1]);
    }
  }
  return Array.from(keys);
}

export async function inspectEnvTemplateFiles(
  cwd: string,
): Promise<EnvTemplateFileInfo[]> {
  const results: EnvTemplateFileInfo[] = [];
  for (const fileName of ALLOWED_ENV_TEMPLATE_FILES) {
    const filePath = path.join(cwd, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      results.push({
        path: filePath,
        fileName,
        keys: extractEnvKeysOnly(content),
      });
    } catch {
      // File not present
    }
  }
  return results;
}

export function isPublicEnvKey(key: string): boolean {
  return PUBLIC_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function isSensitiveEnvKeyName(key: string): boolean {
  const upper = key.toUpperCase();
  return SENSITIVE_KEY_TOKENS.some((token) => upper.includes(token));
}

export function findPublicSecretEnvLeaks(keys: readonly string[]): string[] {
  return keys.filter((key) => isPublicEnvKey(key) && isSensitiveEnvKeyName(key));
}
