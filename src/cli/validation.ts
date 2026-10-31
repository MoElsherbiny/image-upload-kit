import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeImagePath } from '../blur/pathMapper';
import type { BlurManifestData, BlurManifestEntry } from '../blur/types';
import { scanImageDirectory, type ScannedImageFile } from './scanner';

export interface ValidationResult {
  valid: boolean;
  totalEntries: number;
  errors: string[];
  warnings: string[];
}

export interface SyncCheckResult {
  inSync: boolean;
  totalFiles: number;
  totalEntries: number;
  missingKeys: string[];
  orphanedKeys: string[];
}

export interface CleanupResult {
  removedCount: number;
  removedKeys: string[];
  dryRun: boolean;
}

export interface HealthReport {
  validManifest: boolean;
  totalImagesOnDisk: number;
  totalManifestEntries: number;
  coveragePercent: number;
  missingKeys: string[];
  orphanedKeys: string[];
  errors: string[];
  warnings: string[];
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNormalizedKey(key: string): string {
  return normalizeImagePath(key, { stripPrefixes: [] }).normalizedPath;
}

function failValidation(error: string): ValidationResult {
  return { valid: false, totalEntries: 0, errors: [error], warnings: [] };
}

function isDataImageUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function computeKeyDiff(
  files: ScannedImageFile[],
  hashes: Record<string, BlurManifestEntry>,
): { missingKeys: string[]; orphanedKeys: string[] } {
  const diskKeys = new Set(files.map((f) => f.relativeKey));
  const manifestKeys = Object.keys(hashes);
  const normalizedSet = new Set(manifestKeys.map(toNormalizedKey));
  const missingKeys = files
    .map((f) => f.relativeKey)
    .filter((k) => !(k in hashes) && !normalizedSet.has(k));
  const orphanedKeys = manifestKeys.filter(
    (k) => !diskKeys.has(k) && !diskKeys.has(toNormalizedKey(k)),
  );
  return { missingKeys, orphanedKeys };
}

async function readManifestSafe(manifestFile: string): Promise<{
  exists: boolean;
  manifest?: BlurManifestData;
  hashes: Record<string, BlurManifestEntry>;
}> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.resolve(manifestFile), 'utf8'));
    if (isPlainObject(parsed) && isPlainObject(parsed.hashes)) {
      return {
        exists: true,
        manifest: parsed as unknown as BlurManifestData,
        hashes: parsed.hashes as Record<string, BlurManifestEntry>,
      };
    }
    return { exists: true, hashes: {} };
  } catch (err) {
    return { exists: (err as NodeJS.ErrnoException).code !== 'ENOENT', hashes: {} };
  }
}

function validateEntry(key: string, value: unknown, errors: string[], warnings: string[]): void {
  if (!key.startsWith('/')) warnings.push(`Entry key "${key}" should start with "/"`);
  if (!isPlainObject(value)) {
    errors.push(`Entry "${key}" must be an object`);
    return;
  }
  const entry = value as Partial<BlurManifestEntry>;
  if (typeof entry.hash !== 'string' || entry.hash.trim().length < 6) {
    errors.push(`Entry "${key}" has missing or invalid BlurHash "hash"`);
  }
  if (typeof entry.color !== 'string' || !HEX_COLOR_RE.test(entry.color)) {
    errors.push(`Entry "${key}" has missing or invalid hex "color"`);
  }
  if (!isPlainObject(entry.variants)) {
    errors.push(`Entry "${key}" is missing "variants" object`);
    return;
  }
  if (!isDataImageUrl(entry.variants.small)) {
    errors.push(`Entry "${key}" is missing valid "variants.small" data URL`);
  }
  if (entry.variants.medium !== undefined && !isDataImageUrl(entry.variants.medium)) {
    errors.push(`Entry "${key}" has invalid "variants.medium" data URL`);
  }
}

export async function validateBlurHashFile(manifestFile: string): Promise<ValidationResult> {
  const resolvedPath = path.resolve(manifestFile);
  let raw: string;
  try {
    raw = await fs.readFile(resolvedPath, 'utf8');
  } catch {
    return failValidation(`Manifest file not found or unreadable: ${resolvedPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return failValidation(`Invalid JSON in manifest: ${(err as Error).message}`);
  }
  if (!isPlainObject(parsed)) return failValidation('Manifest root must be a JSON object');
  if (!isPlainObject(parsed.hashes)) return failValidation('Manifest is missing a valid "hashes" object');

  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
    warnings.push('Manifest is missing a "version" string');
  }
  if (typeof parsed.generatedAt !== 'string' || Number.isNaN(Date.parse(parsed.generatedAt))) {
    warnings.push('Manifest has missing or invalid "generatedAt" timestamp');
  }

  const entries = Object.entries(parsed.hashes);
  if (typeof parsed.totalImages === 'number' && parsed.totalImages !== entries.length) {
    warnings.push(`Manifest totalImages (${parsed.totalImages}) differs from count (${entries.length})`);
  }
  if (entries.length === 0) warnings.push('Manifest contains 0 image entries');
  for (const [key, value] of entries) validateEntry(key, value, errors, warnings);

  return { valid: errors.length === 0, totalEntries: entries.length, errors, warnings };
}

export async function autoSyncCheck(imagesDir: string, manifestFile: string): Promise<SyncCheckResult> {
  const [files, loaded] = await Promise.all([scanImageDirectory(imagesDir), readManifestSafe(manifestFile)]);
  const { missingKeys, orphanedKeys } = computeKeyDiff(files, loaded.hashes);
  const inSync = loaded.exists && missingKeys.length === 0 && orphanedKeys.length === 0;
  return { inSync, totalFiles: files.length, totalEntries: Object.keys(loaded.hashes).length, missingKeys, orphanedKeys };
}

export async function findMissingBlurHashes(imagesDir: string, manifestFile: string): Promise<string[]> {
  return (await autoSyncCheck(imagesDir, manifestFile)).missingKeys;
}

export async function cleanupOrphanedHashes(
  imagesDir: string,
  manifestFile: string,
  options?: { dryRun?: boolean },
): Promise<CleanupResult> {
  const dryRun = Boolean(options?.dryRun);
  const resolvedPath = path.resolve(manifestFile);
  const [files, loaded] = await Promise.all([scanImageDirectory(imagesDir), readManifestSafe(resolvedPath)]);
  if (!loaded.exists || !loaded.manifest) return { removedCount: 0, removedKeys: [], dryRun };

  const { orphanedKeys } = computeKeyDiff(files, loaded.hashes);
  if (!dryRun && orphanedKeys.length > 0) {
    const orphanSet = new Set(orphanedKeys);
    const hashes = Object.fromEntries(Object.entries(loaded.hashes).filter(([k]) => !orphanSet.has(k)));
    const updated: BlurManifestData = { ...loaded.manifest, generatedAt: new Date().toISOString(), totalImages: Object.keys(hashes).length, hashes };
    await fs.writeFile(resolvedPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  }
  return { removedCount: orphanedKeys.length, removedKeys: orphanedKeys, dryRun };
}

export async function generateHealthReport(imagesDir: string, manifestFile: string): Promise<HealthReport> {
  const [validation, loaded] = await Promise.all([validateBlurHashFile(manifestFile), readManifestSafe(manifestFile)]);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  let files: ScannedImageFile[] = [];
  try {
    files = await scanImageDirectory(imagesDir);
  } catch (err) {
    errors.push(`Failed to scan "${path.resolve(imagesDir)}": ${(err as Error).message}`);
  }

  const { missingKeys, orphanedKeys } = computeKeyDiff(files, loaded.hashes);
  if (missingKeys.length > 0) warnings.push(`${missingKeys.length} missing image(s)`);
  if (orphanedKeys.length > 0) warnings.push(`${orphanedKeys.length} orphaned entry(ies)`);

  const totalImagesOnDisk = files.length;
  const covered = Math.max(0, totalImagesOnDisk - missingKeys.length);
  const coveragePercent =
    totalImagesOnDisk === 0 ? (validation.valid ? 100 : 0) : Number(((covered / totalImagesOnDisk) * 100).toFixed(2));

  return {
    validManifest: validation.valid,
    totalImagesOnDisk,
    totalManifestEntries: validation.totalEntries,
    coveragePercent,
    missingKeys,
    orphanedKeys,
    errors,
    warnings,
  };
}
