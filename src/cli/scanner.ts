import fs from 'node:fs/promises';
import path from 'node:path';

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.svg',
]);

export const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist']);

export interface ScannedImageFile {
  absolutePath: string;
  relativeKey: string;
  size: number;
  mtimeMs: number;
}

/**
 * Recursively scans an image directory for supported image files,
 * ignoring `node_modules`, `.git`, and `dist`, and returning normalized
 * `/` forward-slash relative keys sorted alphabetically.
 */
export async function scanImageDirectory(
  imagesDir: string,
): Promise<ScannedImageFile[]> {
  const rootDir = path.resolve(imagesDir);
  const rootStats = await fs.stat(rootDir);

  if (!rootStats.isDirectory()) {
    throw new Error(`Expected images path to be a directory: ${rootDir}`);
  }

  const results: ScannedImageFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        continue;
      }

      const fileStats = await fs.stat(fullPath);
      const relPath = path
        .relative(rootDir, fullPath)
        .split(path.sep)
        .join('/')
        .replace(/\\/g, '/');
      const relativeKey = relPath.startsWith('/') ? relPath : `/${relPath}`;

      results.push({
        absolutePath: fullPath,
        relativeKey,
        size: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
      });
    }
  }

  await walk(rootDir);
  results.sort((a, b) => a.relativeKey.localeCompare(b.relativeKey));

  return results;
}
