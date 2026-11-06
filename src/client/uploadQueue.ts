import type { QualityLevel } from '../types';

export function resolveInitialQuality(
  q?: number,
  fallback: QualityLevel = 'high',
): QualityLevel {
  if (!q) return fallback;
  return q <= 55 ? 'low' : q <= 78 ? 'medium' : q <= 90 ? 'high' : 'maximum';
}

export async function runParallelUploadPool<T>(
  items: readonly T[],
  maxParallel: number,
  workerFn: (item: T) => Promise<unknown>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(maxParallel, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await workerFn(item);
      }
    }),
  );
}

export function formatMinImagesMessage(
  template: string,
  minImages: number,
): string {
  return template
    .replace('{min}', String(minImages))
    .replace('{suffix}', minImages === 1 ? '' : 's');
}
