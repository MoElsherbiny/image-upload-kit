import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ALLOWED_ENV_TEMPLATE_FILES,
  extractEnvKeysOnly,
  isPublicEnvKey,
  isSensitiveEnvKeyName,
} from '../detection/envInspector';
import { detectEol, normalizeEol } from './fileManager';

export interface EnvEntrySpec {
  key: string;
  placeholder: string;
  comment?: string;
  serverOnly?: boolean;
}

export interface EnvMergeResult {
  targetFileName: string;
  targetPath: string;
  addedKeys: string[];
  reusedKeys: string[];
  rejectedPublicSecrets: string[];
  mergedContent: string;
}

export async function resolveTargetEnvTemplateFile(
  cwd: string,
): Promise<{ fileName: string; filePath: string; existingContent: string | null }> {
  for (const fileName of ALLOWED_ENV_TEMPLATE_FILES) {
    const filePath = path.join(cwd, fileName);
    try {
      const existingContent = await fs.readFile(filePath, 'utf8');
      return { fileName, filePath, existingContent };
    } catch {
      // Try next template candidate
    }
  }
  return {
    fileName: '.env.example',
    filePath: path.join(cwd, '.env.example'),
    existingContent: null,
  };
}

export function mergeEnvTemplateContent(
  existingContent: string | null,
  entries: readonly EnvEntrySpec[],
  sectionHeader = '# img-upload-kit',
): {
  mergedContent: string;
  addedKeys: string[];
  reusedKeys: string[];
  rejectedPublicSecrets: string[];
} {
  const existingKeys = new Set(
    existingContent ? extractEnvKeysOnly(existingContent) : [],
  );
  const addedKeys: string[] = [];
  const reusedKeys: string[] = [];
  const rejectedPublicSecrets: string[] = [];
  const linesToAppend: string[] = [];

  for (const entry of entries) {
    if (isPublicEnvKey(entry.key) && (entry.serverOnly || isSensitiveEnvKeyName(entry.key))) {
      rejectedPublicSecrets.push(entry.key);
      continue;
    }
    if (existingKeys.has(entry.key)) {
      reusedKeys.push(entry.key);
      continue;
    }
    addedKeys.push(entry.key);
    if (entry.comment) linesToAppend.push(`# ${entry.comment}`);
    linesToAppend.push(`${entry.key}=${entry.placeholder}`);
  }

  const eol = existingContent ? detectEol(existingContent) : '\n';
  if (addedKeys.length === 0) {
    return {
      mergedContent: existingContent ?? '',
      addedKeys,
      reusedKeys,
      rejectedPublicSecrets,
    };
  }

  const block = [sectionHeader, ...linesToAppend].join('\n');
  if (!existingContent || existingContent.trim().length === 0) {
    return {
      mergedContent: normalizeEol(`${block}\n`, eol),
      addedKeys,
      reusedKeys,
      rejectedPublicSecrets,
    };
  }

  const base = existingContent.replace(/\r\n/g, '\n').replace(/\n*$/, '');
  const combined = `${base}\n\n${block}\n`;
  return {
    mergedContent: normalizeEol(combined, eol),
    addedKeys,
    reusedKeys,
    rejectedPublicSecrets,
  };
}

export async function planEnvTemplateMerge(
  cwd: string,
  entries: readonly EnvEntrySpec[],
): Promise<EnvMergeResult> {
  const target = await resolveTargetEnvTemplateFile(cwd);
  const merged = mergeEnvTemplateContent(target.existingContent, entries);
  return {
    targetFileName: target.fileName,
    targetPath: target.filePath,
    ...merged,
  };
}
