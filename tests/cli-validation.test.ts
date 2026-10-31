import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlurManifestData, BlurManifestEntry } from '../src/blur/types';
import { scanImageDirectory } from '../src/cli/scanner';
import {
  autoSyncCheck,
  cleanupOrphanedHashes,
  findMissingBlurHashes,
  generateHealthReport,
  validateBlurHashFile,
} from '../src/cli/validation';

const SAMPLE_ENTRY: BlurManifestEntry = {
  hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  color: '#3B82F6',
  variants: {
    small: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  },
};

describe('CLI scanner and manifest validation utilities', () => {
  const tempDirs: string[] = [];

  async function makeTempWorkspace() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-cli-'));
    tempDirs.push(root);
    const imagesDir = path.join(root, 'images');
    const manifestFile = path.join(root, 'blur-hashes.json');
    await fs.mkdir(imagesDir, { recursive: true });
    return { root, imagesDir, manifestFile };
  }

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('scans supported image files recursively and skips non-images and ignored directories', async () => {
    const { imagesDir } = await makeTempWorkspace();

    await fs.mkdir(path.join(imagesDir, 'catalog'), { recursive: true });
    await fs.mkdir(path.join(imagesDir, 'icons'), { recursive: true });
    await fs.mkdir(path.join(imagesDir, 'node_modules', 'pkg'), { recursive: true });

    await fs.writeFile(path.join(imagesDir, 'catalog', 'shoe.webp'), 'webp-bytes');
    await fs.writeFile(path.join(imagesDir, 'icons', 'logo.svg'), '<svg/>');
    await fs.writeFile(path.join(imagesDir, 'notes.txt'), 'ignore-me');
    await fs.writeFile(path.join(imagesDir, 'node_modules', 'pkg', 'skip.png'), 'skip');

    const scanned = await scanImageDirectory(imagesDir);
    expect(scanned.map((f) => f.relativeKey)).toEqual([
      '/catalog/shoe.webp',
      '/icons/logo.svg',
    ]);
    expect(scanned[0].size).toBeGreaterThan(0);
    expect(scanned[0].mtimeMs).toBeGreaterThan(0);
    expect(path.isAbsolute(scanned[0].absolutePath)).toBe(true);
  });

  it('validates missing, malformed, and well-formed blur-hashes.json manifests', async () => {
    const { manifestFile } = await makeTempWorkspace();

    const missing = await validateBlurHashFile(manifestFile);
    expect(missing.valid).toBe(false);
    expect(missing.errors[0]).toContain('Manifest file not found');

    await fs.writeFile(
      manifestFile,
      JSON.stringify({
        version: '2.0',
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalImages: 1,
        hashes: {
          '/bad.avif': {
            hash: 'short',
            color: 'not-hex',
            variants: { small: 'http://not-data-url' },
          },
        },
      }),
      'utf8',
    );

    const invalid = await validateBlurHashFile(manifestFile);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.length).toBeGreaterThanOrEqual(3);

    const validManifest: BlurManifestData = {
      version: '2.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalImages: 1,
      hashes: { '/catalog/shoe.webp': SAMPLE_ENTRY },
    };
    await fs.writeFile(manifestFile, JSON.stringify(validManifest), 'utf8');

    const valid = await validateBlurHashFile(manifestFile);
    expect(valid.valid).toBe(true);
    expect(valid.totalEntries).toBe(1);
    expect(valid.errors).toEqual([]);
  });

  it('detects missing & orphaned keys, cleans up orphans (dryRun & live), and generates health reports', async () => {
    const { imagesDir, manifestFile } = await makeTempWorkspace();

    await fs.mkdir(path.join(imagesDir, 'catalog'), { recursive: true });
    await fs.mkdir(path.join(imagesDir, 'icons'), { recursive: true });
    await fs.writeFile(path.join(imagesDir, 'catalog', 'shoe.webp'), 'webp-bytes');
    await fs.writeFile(path.join(imagesDir, 'icons', 'logo.svg'), '<svg/>');

    const initialManifest: BlurManifestData = {
      version: '2.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalImages: 2,
      hashes: {
        '/catalog/shoe.webp': SAMPLE_ENTRY,
        '/legacy/removed.avif': SAMPLE_ENTRY,
      },
    };
    await fs.writeFile(manifestFile, JSON.stringify(initialManifest, null, 2), 'utf8');

    expect(await findMissingBlurHashes(imagesDir, manifestFile)).toEqual(['/icons/logo.svg']);

    const syncBefore = await autoSyncCheck(imagesDir, manifestFile);
    expect(syncBefore).toEqual({
      inSync: false,
      totalFiles: 2,
      totalEntries: 2,
      missingKeys: ['/icons/logo.svg'],
      orphanedKeys: ['/legacy/removed.avif'],
    });

    const reportBefore = await generateHealthReport(imagesDir, manifestFile);
    expect(reportBefore.validManifest).toBe(true);
    expect(reportBefore.totalImagesOnDisk).toBe(2);
    expect(reportBefore.totalManifestEntries).toBe(2);
    expect(reportBefore.coveragePercent).toBe(50);
    expect(reportBefore.missingKeys).toEqual(['/icons/logo.svg']);
    expect(reportBefore.orphanedKeys).toEqual(['/legacy/removed.avif']);

    // dryRun: true reports orphans without mutating disk manifest
    const dryCleanup = await cleanupOrphanedHashes(imagesDir, manifestFile, { dryRun: true });
    expect(dryCleanup).toEqual({
      removedCount: 1,
      removedKeys: ['/legacy/removed.avif'],
      dryRun: true,
    });
    const afterDry = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as BlurManifestData;
    expect(afterDry.hashes['/legacy/removed.avif']).toBeDefined();

    // dryRun: false removes orphans and updates totalImages
    const liveCleanup = await cleanupOrphanedHashes(imagesDir, manifestFile, { dryRun: false });
    expect(liveCleanup).toEqual({
      removedCount: 1,
      removedKeys: ['/legacy/removed.avif'],
      dryRun: false,
    });
    const afterLive = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as BlurManifestData;
    expect(afterLive.hashes['/legacy/removed.avif']).toBeUndefined();
    expect(afterLive.totalImages).toBe(1);

    // Add missing entry -> 100% in sync
    afterLive.hashes['/icons/logo.svg'] = SAMPLE_ENTRY;
    afterLive.totalImages = 2;
    await fs.writeFile(manifestFile, JSON.stringify(afterLive, null, 2), 'utf8');

    const syncAfter = await autoSyncCheck(imagesDir, manifestFile);
    expect(syncAfter.inSync).toBe(true);

    const reportAfter = await generateHealthReport(imagesDir, manifestFile);
    expect(reportAfter.coveragePercent).toBe(100);
    expect(reportAfter.missingKeys).toEqual([]);
    expect(reportAfter.orphanedKeys).toEqual([]);
  });
});
