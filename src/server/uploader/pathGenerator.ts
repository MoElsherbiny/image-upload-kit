import crypto from 'node:crypto';
import type { ImageOutputFormat } from '../../types';
import type {
  GeneratedStorageTarget,
  StoragePathContext,
  StoragePathGenerator,
} from './types';

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

export function createDefaultPathGenerator(): StoragePathGenerator {
  let imageCounter = 0;

  return (ctx: StoragePathContext): GeneratedStorageTarget => {
    const cleanFolder = ctx.folder ? sanitizeSegment(ctx.folder) : '';

    if (ctx.customFilename?.trim()) {
      let cleanName = ctx.customFilename.replace(/^.*[\\/]/, '').trim();
      if (!cleanName.includes('.')) {
        cleanName = `${cleanName}.${ctx.extension}`;
      }
      cleanName = cleanName.replace(/[^a-zA-Z0-9._-]/g, '-');
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
    const randomSuffix = crypto.randomUUID().split('-')[0];

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
