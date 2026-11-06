import type { QualityLevel, UploadedImageData } from '../../types';
import type { ImagePreview } from '../types';

export function mapUploadedToPreview(
  img: UploadedImageData,
  prev?: ImagePreview,
): ImagePreview {
  const altText =
    prev?.altText && !img.altText?.trim() ? prev.altText : img.altText;
  return {
    id: prev?.id || img.url,
    url: img.url,
    file: null,
    uploadMessage: null,
    originalSize: img.originalSize ?? prev?.originalSize,
    optimizedSize: img.size ?? prev?.optimizedSize,
    data: { ...img, altText },
    altText,
    blurColor: img.blurColor || prev?.blurColor,
  };
}

export function resolveInitialQuality(
  q?: number,
  fallback: QualityLevel = 'high',
): QualityLevel {
  if (!q) return fallback;
  return q <= 55 ? 'low' : q <= 78 ? 'medium' : q <= 90 ? 'high' : 'maximum';
}

export function collectUploadedData(
  list: ImagePreview[],
  readyOnly: boolean,
): UploadedImageData[] {
  return list
    .filter((p) => p.data && (!readyOnly || !p.isUploading))
    .map((p) => ({
      ...p.data!,
      altText: p.altText ?? p.data!.altText,
      blurColor: p.blurColor ?? p.data!.blurColor,
    }));
}

export function syncPreviewsWithValue(
  current: ImagePreview[],
  value: UploadedImageData[],
  requiresManualCommit: boolean,
  uncommittedIds?: ReadonlySet<string>,
): ImagePreview[] {
  const prevMap = new Map<string, ImagePreview>();
  current.forEach((p) => {
    prevMap.set(p.id, p);
    if (p.url) prevMap.set(p.url, p);
    if (p.data?.url) prevMap.set(p.data.url, p);
  });

  const synced = value.map((img) =>
    mapUploadedToPreview(img, prevMap.get(img.url)),
  );

  const pending = current.filter((p) => {
    const inValue = value.some(
      (img) =>
        img.url === p.id ||
        (p.url && img.url === p.url) ||
        (p.data?.url && img.url === p.data.url),
    );
    if (inValue) return false;
    if (p.isUploading || Boolean(p.error)) return true;
    if (
      requiresManualCommit &&
      Boolean(p.data) &&
      (uncommittedIds ? uncommittedIds.has(p.id) : p.id.startsWith('temp-'))
    ) {
      return true;
    }
    return false;
  });

  const next = [...synced, ...pending];
  const isSame =
    next.length === current.length &&
    next.every((it, idx) => {
      const p = current[idx];
      return (
        p &&
        p.id === it.id &&
        p.url === it.url &&
        p.altText === it.altText &&
        p.blurColor === it.blurColor &&
        p.isUploading === it.isUploading &&
        p.error === it.error
      );
    });

  return isSame ? current : next;
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

export function serializeMultiFormValue(
  previews: ImagePreview[],
  formValue: 'url' | 'json' = 'json',
): string {
  const uploaded = collectUploadedData(previews, true);
  if (uploaded.length === 0) return '';
  if (formValue === 'url') {
    return uploaded.map((img) => img.url).join(',');
  }
  return JSON.stringify(uploaded);
}

export function formatMinImagesMessage(
  template: string,
  minImages: number,
): string {
  return template
    .replace('{min}', String(minImages))
    .replace('{suffix}', minImages === 1 ? '' : 's');
}
