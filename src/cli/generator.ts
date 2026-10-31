import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { BlurManifestData, BlurManifestEntry } from '../blur/types';
import {
  encodeBlurHashString,
  generateBlurPlaceholder,
} from '../server/optimization';
import { AsyncSemaphore } from '../server/semaphore';
import { scanImageDirectory, type ScannedImageFile } from './scanner';

export interface GenerateManifestOptions {
  concurrency?: number;
  force?: boolean;
  includeMedium?: boolean;
  onProgress?: (done: number, total: number, key: string) => void;
}

export interface GenerateManifestResult {
  manifest: BlurManifestData;
  processed: number;
  cached: number;
  failed: number;
  outputPath: string;
}

const FALLBACK_BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';
const MANIFEST_VERSION = '2.0';

async function loadExistingHashes(
  manifestPath: string,
): Promise<Record<string, BlurManifestEntry>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'hashes' in parsed &&
      parsed.hashes &&
      typeof parsed.hashes === 'object' &&
      !Array.isArray(parsed.hashes)
    ) {
      return parsed.hashes as Record<string, BlurManifestEntry>;
    }
    return {};
  } catch {
    return {};
  }
}

function canReuseCachedEntry(
  entry: BlurManifestEntry | undefined,
  file: ScannedImageFile,
  includeMedium: boolean,
): entry is BlurManifestEntry {
  if (!entry || typeof entry !== 'object') return false;
  if (!entry.hash || !entry.color || !entry.variants?.small) return false;
  if (entry.metadata) {
    if (entry.metadata.size && entry.metadata.size !== String(file.size)) {
      return false;
    }
    if (
      entry.metadata.mtimeMs &&
      entry.metadata.mtimeMs !== String(Math.round(file.mtimeMs))
    ) {
      return false;
    }
    if (includeMedium && !entry.variants.medium) return false;
  }
  return true;
}

async function resolveImageDimensions(
  buffer: Buffer,
  isSvg: boolean,
): Promise<{ width?: number; height?: number }> {
  const metadata = await sharp(buffer).metadata();
  let { width, height } = metadata;

  if ((!width || !height) && isSvg) {
    const match = buffer
      .toString('utf8')
      .match(/viewBox\s*=\s*["']\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*["']/i);
    if (match) {
      width = Math.round(Number.parseFloat(match[3]));
      height = Math.round(Number.parseFloat(match[4]));
    }
  }

  return { width, height };
}

/**
 * Generates or updates a `blur-hashes.json` manifest from an image directory
 * with bounded concurrency and incremental cache reuse.
 */
export async function generateBlurManifest(
  imagesDir: string,
  manifestFile: string,
  options: GenerateManifestOptions = {},
): Promise<GenerateManifestResult> {
  const outputPath = path.resolve(manifestFile);
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const includeMedium = options.includeMedium ?? true;
  const force = Boolean(options.force);

  const files = await scanImageDirectory(imagesDir);
  const existingHashes = force ? {} : await loadExistingHashes(outputPath);
  const semaphore = new AsyncSemaphore(concurrency);
  const generatedEntries = new Map<string, BlurManifestEntry>();

  let processed = 0;
  let cached = 0;
  let failed = 0;
  let done = 0;
  const total = files.length;

  await Promise.all(
    files.map((file) =>
      semaphore.run(async () => {
        try {
          const prior = force ? undefined : existingHashes[file.relativeKey];
          if (canReuseCachedEntry(prior, file, includeMedium)) {
            generatedEntries.set(file.relativeKey, prior);
            cached += 1;
            return;
          }

          const buffer = await fs.readFile(file.absolutePath);
          const isSvg = file.relativeKey.toLowerCase().endsWith('.svg');
          const { width, height } = await resolveImageDimensions(buffer, isSvg);

          const small = await generateBlurPlaceholder(buffer, {
            width: 64,
            fallbackWidth: 48,
            includeBlurHash: true,
          });
          const medium = includeMedium
            ? await generateBlurPlaceholder(buffer, {
                width: 128,
                fallbackWidth: 96,
                includeBlurHash: false,
              })
            : undefined;

          const hash =
            small.blurHash ||
            (await encodeBlurHashString(buffer).catch(() => FALLBACK_BLURHASH));

          generatedEntries.set(file.relativeKey, {
            hash,
            variants: {
              small: small.dataURL,
              ...(medium ? { medium: medium.dataURL } : {}),
            },
            color: small.color,
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
            metadata: {
              size: String(file.size),
              mtimeMs: String(Math.round(file.mtimeMs)),
            },
          });
          processed += 1;
        } catch {
          failed += 1;
        } finally {
          done += 1;
          options.onProgress?.(done, total, file.relativeKey);
        }
      }),
    ),
  );

  const orderedHashes: Record<string, BlurManifestEntry> = {};
  for (const file of files) {
    const entry = generatedEntries.get(file.relativeKey);
    if (entry) orderedHashes[file.relativeKey] = entry;
  }

  const manifest: BlurManifestData = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    totalImages: Object.keys(orderedHashes).length,
    processedImages: processed,
    cachedImages: cached,
    failedImages: failed,
    hashes: orderedHashes,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { manifest, processed, cached, failed, outputPath };
}
