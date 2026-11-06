import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlurManifestData, BlurManifestEntry } from '../src/blur/types';
import { createCliProgram, generateBlurManifest, runCli } from '../src/cli';
import { solidImage } from './helpers/imageFixtures';

const SAMPLE_ENTRY: BlurManifestEntry = {
  hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  color: '#3B82F6',
  variants: {
    small:
      'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
    medium:
      'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
  },
};

describe('CLI generator, cache invalidation, and sync --fix', () => {
  const tempDirs: string[] = [];

  async function makeTempWorkspace() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-cli-gen-'));
    tempDirs.push(root);
    const imagesDir = path.join(root, 'images');
    const manifestFile = path.join(root, 'blur-hashes.json');
    await fs.mkdir(imagesDir, { recursive: true });
    return { root, imagesDir, manifestFile };
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('imports src/cli with zero side effects and exposes CLI program', () => {
    const program = createCliProgram();
    expect(program.name()).toBe('img-upload-kit');
    expect(typeof runCli).toBe('function');
  });

  it('generates blur manifest (happy path), reuses valid cache, and invalidates entries missing metadata', async () => {
    const { imagesDir, manifestFile } = await makeTempWorkspace();
    const pngBytes = await solidImage(64, 48, 'png');
    await fs.writeFile(path.join(imagesDir, 'card.png'), pngBytes);

    // 1. First run generates from scratch
    const first = await generateBlurManifest(imagesDir, manifestFile);
    expect(first.processed).toBe(1);
    expect(first.cached).toBe(0);
    expect(first.failed).toBe(0);
    expect(first.manifest.hashes['/card.png']).toBeDefined();
    expect(first.manifest.hashes['/card.png'].width).toBe(64);
    expect(first.manifest.hashes['/card.png'].height).toBe(48);
    expect(first.manifest.hashes['/card.png'].metadata?.size).toBe(
      String(pngBytes.length),
    );

    // 2. Second run reuses cached entry via metadata size + mtimeMs
    const second = await generateBlurManifest(imagesDir, manifestFile);
    expect(second.processed).toBe(0);
    expect(second.cached).toBe(1);
    expect(second.failed).toBe(0);

    // 3. Entry missing metadata is treated as stale and regenerated
    const staleManifest: BlurManifestData = {
      version: '2.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalImages: 1,
      hashes: {
        '/card.png': {
          ...SAMPLE_ENTRY,
          metadata: undefined,
        },
      },
    };
    await fs.writeFile(
      manifestFile,
      JSON.stringify(staleManifest, null, 2),
      'utf8',
    );

    const third = await generateBlurManifest(imagesDir, manifestFile);
    expect(third.processed).toBe(1);
    expect(third.cached).toBe(0);
    expect(third.manifest.hashes['/card.png'].metadata?.size).toBe(
      String(pngBytes.length),
    );
  });

  it('logs a warning and retains prior cached entry when per-file generation fails', async () => {
    const { imagesDir, manifestFile } = await makeTempWorkspace();
    const corruptPath = path.join(imagesDir, 'broken.png');
    await fs.writeFile(corruptPath, Buffer.from('not-an-image'));

    const existingManifest: BlurManifestData = {
      version: '2.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalImages: 1,
      hashes: {
        '/broken.png': {
          ...SAMPLE_ENTRY,
          // Stale metadata forces regeneration attempt
          metadata: { size: '999999', mtimeMs: '1' },
        },
      },
    };
    await fs.writeFile(
      manifestFile,
      JSON.stringify(existingManifest, null, 2),
      'utf8',
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await generateBlurManifest(imagesDir, manifestFile);

    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    // Prior entry is preserved in the output manifest instead of being dropped
    expect(result.manifest.hashes['/broken.png']).toBeDefined();
    expect(result.manifest.hashes['/broken.png'].color).toBe('#3B82F6');
  });

  it('sync --fix removes orphaned entries even when there are 0 missing entries', async () => {
    const { imagesDir, manifestFile } = await makeTempWorkspace();
    const pngBytes = await solidImage(32, 32, 'png');
    const imgPath = path.join(imagesDir, 'keep.png');
    await fs.writeFile(imgPath, pngBytes);
    const stat = await fs.stat(imgPath);

    const manifestWithOrphan: BlurManifestData = {
      version: '2.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalImages: 2,
      hashes: {
        '/keep.png': {
          ...SAMPLE_ENTRY,
          metadata: {
            size: String(stat.size),
            mtimeMs: String(Math.round(stat.mtimeMs)),
          },
        },
        '/deleted-orphan.png': SAMPLE_ENTRY,
      },
    };
    await fs.writeFile(
      manifestFile,
      JSON.stringify(manifestWithOrphan, null, 2),
      'utf8',
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['sync', '-d', imagesDir, '-f', manifestFile, '--fix']);
    expect(logSpy).toHaveBeenCalled();

    const updated = JSON.parse(
      await fs.readFile(manifestFile, 'utf8'),
    ) as BlurManifestData;
    expect(Object.keys(updated.hashes)).toEqual(['/keep.png']);
    expect(updated.totalImages).toBe(1);
  });
});
