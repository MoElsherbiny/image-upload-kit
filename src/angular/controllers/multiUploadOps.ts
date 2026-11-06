import type { UploadedImageData } from '../../types';
import { normalizeColorInput } from '../../utils/color';
import type { AngularMultiUploadItem } from '../types';
import { createBlobPreview } from './uploadHelpers';

let multiItemSeq = 0;

export function mapDataToItem(
  data: UploadedImageData,
  idx: number,
): AngularMultiUploadItem {
  multiItemSeq += 1;
  return {
    id: `item-${idx}-${multiItemSeq}`,
    url: data.url,
    queueIndex: idx,
    data,
    altText: data.altText,
    blurColor: data.blurColor,
    isUploading: false,
    progress: 100,
    originalSize: data.originalSize,
    optimizedSize: data.size,
  };
}

export function createQueuedMultiItem(
  file: File,
  queueIndex: number,
  initialMessage: string,
): AngularMultiUploadItem {
  multiItemSeq += 1;
  return {
    id: `multi-${Date.now()}-${multiItemSeq}`,
    url: createBlobPreview(file),
    file,
    fileName: file.name,
    queueIndex,
    originalSize: file.size,
    isUploading: true,
    progress: 0,
    uploadMessage: initialMessage,
  };
}

export function collectCompletedItems(
  list: AngularMultiUploadItem[],
): UploadedImageData[] {
  return list
    .filter((i) => Boolean(i.data) && !i.isUploading)
    .map((i) => i.data!);
}

export function countMissingAltItems(
  list: AngularMultiUploadItem[],
  requireAlt: boolean,
): number {
  if (!requireAlt) return 0;
  return list.filter(
    (i) =>
      Boolean(i.data) &&
      !i.isUploading &&
      !(i.altText ?? i.data?.altText)?.trim(),
  ).length;
}

export function applyItemAltText(
  item: AngularMultiUploadItem,
  altText: string,
): AngularMultiUploadItem {
  return {
    ...item,
    altText,
    data: item.data ? { ...item.data, altText } : undefined,
  };
}

export function resolveNormalizedColor(color: string): string | null {
  return normalizeColorInput(color);
}

export function applyItemBlurColor(
  item: AngularMultiUploadItem,
  normalizedColor: string,
): AngularMultiUploadItem {
  return {
    ...item,
    blurColor: normalizedColor,
    data: item.data ? { ...item.data, blurColor: normalizedColor } : undefined,
  };
}
