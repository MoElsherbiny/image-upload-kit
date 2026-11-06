import { useCallback, useRef, useState } from 'react';
import {
  moveItem,
  type NativeUploadAsset,
  promoteToCover,
  runParallelUploadPool,
} from '../../client';
import type { UploadedImageData } from '../../types';
import { useNativeImageUploadConfig } from '../context';
import type {
  NativeImagePickerOptions,
  NativeMultiImageUploadProps,
  NativeMultiUploadItem,
  NativeMultiUploadReturn,
} from '../types';
import { useNativeUpload } from './useNativeUpload';

let multiItemCounter = 0;
function nextItemId(): string {
  multiItemCounter += 1;
  return `rn-item-${Date.now()}-${multiItemCounter}`;
}

function toCompletedItem(data: UploadedImageData): NativeMultiUploadItem {
  return {
    id: nextItemId(),
    uri: data.url,
    isUploading: false,
    progress: 100,
    error: null,
    data,
  };
}

function extractImages(items: readonly NativeMultiUploadItem[]): UploadedImageData[] {
  const result: UploadedImageData[] = [];
  for (const item of items) {
    if (item.data) result.push(item.data);
  }
  return result;
}

export function useNativeMultiUpload(
  props: NativeMultiImageUploadProps = {},
): NativeMultiUploadReturn {
  const ctx = useNativeImageUploadConfig();
  const maxImages = props.maxImages ?? 10;
  const maxParallel = props.maxParallelUploads ?? 3;
  const picker = props.picker ?? ctx.picker;

  const initialSeed = props.value ?? props.defaultValue ?? [];
  const [items, setItems] = useState<NativeMultiUploadItem[]>(() =>
    initialSeed.map(toCompletedItem),
  );
  const itemsRef = useRef<NativeMultiUploadItem[]>(items);
  itemsRef.current = items;
  const [error, setError] = useState<string | null>(null);

  const { uploadAsset: rawUploadAsset, cancelUpload, deleteImage } = useNativeUpload({
    endpoint: props.endpoint,
    deleteEndpoint: props.deleteEndpoint,
    headers: props.headers,
    withCredentials: props.withCredentials,
    defaultPreset: props.preset,
    maxSizeMB: props.maxSizeMB,
    transformAsset: props.transformAsset,
    customUploader: props.customUploader,
    customDeleter: props.customDeleter,
  });

  const commitItems = useCallback(
    (
      updater: (prev: NativeMultiUploadItem[]) => NativeMultiUploadItem[],
      notifyChange = false,
      notifyReorder = false,
    ) => {
      const next = updater(itemsRef.current);
      itemsRef.current = next;
      setItems(next);
      if (notifyChange || notifyReorder) {
        const imgs = extractImages(next);
        if (notifyChange) props.onChange?.(imgs);
        if (notifyReorder) props.onReorder?.(imgs);
      }
      return next;
    },
    [props],
  );

  const uploadSingleEntry = useCallback(
    async (
      entryId: string,
      asset: NativeUploadAsset,
      index: number,
    ): Promise<UploadedImageData | null> => {
      try {
        const uploaded = await rawUploadAsset(asset, {
          id: entryId,
          index,
          preset: props.preset,
          folder: props.folder,
          bucket: props.bucket,
          quality: props.quality,
          aspectRatio: props.aspectRatio,
          crop: props.crop,
          maxSizeMB: props.maxSizeMB,
          metadata: props.metadata,
          transformAsset: props.transformAsset,
          onProgress: (pct) =>
            commitItems((prev) =>
              prev.map((i) => (i.id === entryId ? { ...i, progress: pct } : i)),
            ),
        });

        if (!uploaded) {
          commitItems((prev) => prev.filter((item) => item.id !== entryId));
          return null;
        }

        commitItems(
          (prev) =>
            prev.map((item) =>
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
            ),
          true,
        );
        return uploaded;
      } catch (err) {
        const normalized =
          err instanceof Error ? err : new Error('Image upload failed');
        setError(normalized.message);
        props.onError?.(normalized);
        commitItems((prev) =>
          prev.map((item) =>
            item.id === entryId
              ? { ...item, isUploading: false, error: normalized.message }
              : item,
          ),
        );
        return null;
      }
    },
    [commitItems, props, rawUploadAsset],
  );

  const addAssets = useCallback(
    async (assets: NativeUploadAsset[]): Promise<UploadedImageData[]> => {
      if (props.disabled || assets.length === 0) return [];
      const remaining = Math.max(0, maxImages - itemsRef.current.length);
      if (remaining === 0) {
        const limitErr = new Error(`Maximum of ${maxImages} images allowed`);
        setError(limitErr.message);
        props.onError?.(limitErr);
        return [];
      }

      const accepted = assets.slice(0, remaining);
      setError(null);
      const newEntries: NativeMultiUploadItem[] = accepted.map((asset) => ({
        id: nextItemId(),
        uri: asset.uri,
        asset,
        isUploading: true,
        progress: 0,
        error: null,
      }));
      commitItems((prev) => [...prev, ...newEntries]);

      const completedBatch: UploadedImageData[] = [];
      await runParallelUploadPool(newEntries, maxParallel, async (entry) => {
        if (!entry.asset) return;
        const idx = itemsRef.current.findIndex((i) => i.id === entry.id);
        const res = await uploadSingleEntry(entry.id, entry.asset, idx >= 0 ? idx : 0);
        if (res) completedBatch.push(res);
      });

      if (completedBatch.length > 0) {
        props.onUploadComplete?.(extractImages(itemsRef.current));
      }
      return completedBatch;
    },
    [commitItems, maxImages, maxParallel, props, uploadSingleEntry],
  );

  const pickFromLibrary = useCallback(
    async (options?: NativeImagePickerOptions): Promise<UploadedImageData[]> => {
      if (props.disabled || !picker) return [];
      const remaining = Math.max(0, maxImages - itemsRef.current.length);
      const picked = await picker.pickFromLibrary({
        multiple: true,
        maxFiles: remaining,
        aspectRatio: props.aspectRatio,
        ...options,
      });
      return addAssets(picked);
    },
    [addAssets, maxImages, picker, props.aspectRatio, props.disabled],
  );

  const takePhoto = useCallback(
    async (options?: NativeImagePickerOptions): Promise<UploadedImageData[]> => {
      if (props.disabled || !picker) return [];
      const picked = await picker.takePhoto({
        multiple: false,
        maxFiles: 1,
        aspectRatio: props.aspectRatio,
        ...options,
      });
      return addAssets(picked);
    },
    [addAssets, picker, props.aspectRatio, props.disabled],
  );

  const cancelItem = useCallback(
    (id: string) => {
      cancelUpload(id);
      commitItems((prev) => prev.filter((item) => item.id !== id));
    },
    [cancelUpload, commitItems],
  );

  const removeItem = useCallback(
    async (id: string) => {
      const target = itemsRef.current.find((item) => item.id === id);
      if (!target) return;
      if (target.isUploading) return cancelItem(id);
      commitItems((prev) => prev.filter((item) => item.id !== id), true);
      if (target.data?.url && (props.deleteEndpoint || props.customDeleter)) {
        try {
          await deleteImage(target.data.url);
        } catch {
          // Ignore delete errors after optimistic removal
        }
      }
    },
    [cancelItem, commitItems, deleteImage, props.customDeleter, props.deleteEndpoint],
  );

  const retryItem = useCallback(
    async (id: string): Promise<UploadedImageData | null> => {
      const target = itemsRef.current.find((item) => item.id === id);
      if (!target?.asset) return null;
      setError(null);
      commitItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, isUploading: true, progress: 0, error: null } : i,
        ),
      );
      const idx = itemsRef.current.findIndex((i) => i.id === id);
      return uploadSingleEntry(id, target.asset, idx >= 0 ? idx : 0);
    },
    [commitItems, uploadSingleEntry],
  );

  const move = useCallback(
    (fromIndex: number, toIndex: number) => {
      commitItems((prev) => moveItem(prev, fromIndex, toIndex), true, true);
    },
    [commitItems],
  );

  const setCover = useCallback(
    (index: number) => {
      commitItems((prev) => promoteToCover(prev, index), true, true);
    },
    [commitItems],
  );

  const clearAll = useCallback(() => {
    cancelUpload();
    commitItems(() => [], true);
  }, [cancelUpload, commitItems]);

  return {
    items,
    images: extractImages(items),
    isUploading: items.some((i) => i.isUploading),
    error,
    canAddMore: items.length < maxImages,
    pickFromLibrary,
    takePhoto,
    addAssets,
    removeItem,
    cancelItem,
    retryItem,
    move,
    setCover,
    setPrimary: setCover,
    clearAll,
  };
}
