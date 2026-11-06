import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runDistChecks } from '../scripts/check-dist.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const hasDist =
  existsSync(path.join(distDir, 'index.js')) &&
  existsSync(path.join(distDir, 'react.js'));

type ReactEntry = { useImageUploadContext: unknown; ImageUploadProvider: unknown; blurService: unknown };
type HeadlessEntry = { useImageUploadContext: unknown; ImageUploadProvider: unknown };
type BlurEntry = { blurService: unknown };

describe.skipIf(!hasDist)('dist smoke (run `npm run build` first)', () => {
  it('passes every static check from scripts/check-dist.mjs', () => {
    const { failures, passes } = runDistChecks(rootDir);
    expect(failures).toEqual([]);
    expect(passes.length).toBeGreaterThan(10);
  });

  it('ESM: /react, /headless and /blur share one context and one blurService', async () => {
    const load = (file: string) => import(pathToFileURL(path.join(distDir, file)).href);
    const react = (await load('react.js')) as ReactEntry;
    const headless = (await load('headless.js')) as HeadlessEntry;
    const blur = (await load('blur.js')) as BlurEntry;
    expect(react.useImageUploadContext).toBe(headless.useImageUploadContext);
    expect(react.ImageUploadProvider).toBe(headless.ImageUploadProvider);
    expect(react.blurService).toBe(blur.blurService);
  });

  it('CJS: /react, /headless and /blur share one context and one blurService', () => {
    const requireDist = createRequire(path.join(distDir, 'index.cjs'));
    const react = requireDist('./react.cjs') as ReactEntry;
    const headless = requireDist('./headless.cjs') as HeadlessEntry;
    const blur = requireDist('./blur.cjs') as BlurEntry;
    expect(react.useImageUploadContext).toBe(headless.useImageUploadContext);
    expect(react.ImageUploadProvider).toBe(headless.ImageUploadProvider);
    expect(react.blurService).toBe(blur.blurService);
  });
});
