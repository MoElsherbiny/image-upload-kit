import type { NativeUploadAsset } from '../../client';
import type { UploadedImageData } from '../../types';
import type { NativeMultiUploadItem } from '../types';

let multiItemCounter = 0;

export function nextNativeMultiItemId(): string {
  multiItemCounter += 1;
  return `rn-item-${Date.now()}-${multiItemCounter}`;
}

export function toCompletedNativeItem(
  data: UploadedImageData,
): NativeMultiUploadItem {
  return {
    id: nextNativeMultiItemId(),
    uri: data.url,
    isUploading: false,
    progress: 100,
    error: null,
    data,
  };
}

export function createPendingNativeItems(
  assets: readonly NativeUploadAsset[],
): NativeMultiUploadItem[] {
  return assets.map((asset) => ({
    id: nextNativeMultiItemId(),
    uri: asset.uri,
    asset,
    isUploading: true,
    progress: 0,
    error: null,
  }));
}

export function extractUploadedImages(
  items: readonly NativeMultiUploadItem[],
): UploadedImageData[] {
  const result: UploadedImageData[] = [];
  for (const item of items) {
    if (item.data) result.push(item.data);
  }
  return result;
}

export function markNativeItemCompleted(
  items: readonly NativeMultiUploadItem[],
  entryId: string,
  uploaded: UploadedImageData,
): NativeMultiUploadItem[] {
  return items.map((item) =>
    item.id === entryId
      ? {
          ...item,
          uri: uploaded.url,
          isUploading: false,
          progress: 100,
          error: null,
          data: uploaded,
        }
      : item,
  );
}

export function markNativeItemError(
  items: readonly NativeMultiUploadItem[],
  entryId: string,
  message: string,
): NativeMultiUploadItem[] {
  return items.map((item) =>
    item.id === entryId
      ? { ...item, isUploading: false, error: message }
      : item,
  );
}

export function markNativeItemRetrying(
  items: readonly NativeMultiUploadItem[],
  entryId: string,
): NativeMultiUploadItem[] {
  return items.map((item) =>
    item.id === entryId
      ? { ...item, isUploading: true, progress: 0, error: null }
      : item,
  );
}
