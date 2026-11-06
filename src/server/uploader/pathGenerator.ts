import type { ImageOutputFormat } from '../../types';
import type {
  GeneratedStorageTarget,
  StoragePathContext,
  StoragePathGenerator,
} from './types';

function randomShortId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID().split('-')[0];
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

export function formatToExtension(format: ImageOutputFormat): string {
  switch (format) {
    case 'svg':
      return 'svg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'jpeg':
      return 'jpg';
    default:
      return 'avif';
  }
}

export function sanitizeSegment(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._-]/g, '-'))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

export function stripFilenameExtension(rawFilename: string): string {
  const leaf = rawFilename.replace(/^.*[\\/]/, '').trim();
  const dotIdx = leaf.lastIndexOf('.');
  const base = dotIdx > 0 ? leaf.slice(0, dotIdx) : leaf;
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return cleaned || 'image';
}

export function createDefaultPathGenerator(): StoragePathGenerator {
  let imageCounter = 0;

  return (ctx: StoragePathContext): GeneratedStorageTarget => {
    const cleanFolder = ctx.folder ? sanitizeSegment(ctx.folder) : '';

    if (ctx.customFilename?.trim()) {
      const baseName = stripFilenameExtension(ctx.customFilename);
      const cleanName = `${baseName}.${ctx.extension}`;
      const fullPath = cleanFolder ? `${cleanFolder}/${cleanName}` : cleanName;
      return {
        bucket: ctx.bucket,
        path: fullPath,
        filename: cleanName,
      };
    }

    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    imageCounter = (imageCounter + 1) % 10000;
    const seq = String(imageCounter).padStart(4, '0');
    const timestamp = Date.now();
    const randomSuffix = randomShortId();

    const prefix = sanitizeSegment(
      ctx.preset || cleanFolder.split('/')[0] || 'img',
    );
    const filename = `${prefix}-${year}${month}${day}-${seq}-${timestamp}-${randomSuffix}.${ctx.extension}`;
    const fullPath = cleanFolder
      ? `${cleanFolder}/${year}/${month}/${filename}`
      : `${year}/${month}/${filename}`;

    return {
      bucket: ctx.bucket,
      path: fullPath,
      filename,
    };
  };
}
