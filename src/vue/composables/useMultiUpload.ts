import {
  type ComputedRef, computed, getCurrentInstance, getCurrentScope, onScopeDispose, type Ref, ref,
} from 'vue';
import {
  createUploadTracker, isUploadAbortError, moveItem, promoteToCover, runParallelUploadPool,
} from '../../client';
import type { QualityLevel, UploadedImageData, UploadPresetName } from '../../types';
import { normalizeColorInput } from '../../utils/color';
import { validateMultipleFiles } from '../../utils/validators';
import { useImageUploadConfig } from '../config';
import type { UploadVisualState, VueMultiUploadItem, VueMultiUploadOptions } from '../types';
import {
  computeVisualState, createBlobPreview, executeDeleteRequest,
  executeUploadRequest, prepareAndValidateAsset, resolveControllerEnv, revokeBlobUrl,
} from './uploadHelpers';

export interface VueMultiUploadController {
  items: Ref<VueMultiUploadItem[]>;
  value: ComputedRef<UploadedImageData[]>;
  isUploading: ComputedRef<boolean>;
  progress: ComputedRef<number>;
  error: Ref<string>;
  liveAnnouncement: Ref<string>;
  canAddMore: ComputedRef<boolean>;
  disabled: Ref<boolean>;
  state: ComputedRef<UploadVisualState>;
  quality: Ref<QualityLevel>;
  missingAltCount: ComputedRef<number>;
  canSave: ComputedRef<boolean>;
  reorderable: boolean;
  showCoverBadge: boolean;
  coverBadgeLabel: string;
  addFiles: (files: FileList | File[]) => Promise<UploadedImageData[]>;
  removeItem: (id: string) => Promise<void>;
  cancelItem: (id: string) => void;
  retryItem: (id: string) => Promise<void>;
  retryAll: () => Promise<void>;
  retryFailed: () => Promise<void>;
  setItemAltText: (id: string, alt: string) => void;
  setItemBlurColor: (id: string, color: string) => void;
  move: (fromIndex: number, toIndex: number) => void;
  setCover: (index: number) => void;
  setPrimary: (index: number) => void;
  setValue: (val: UploadedImageData[]) => void;
  clearAll: () => Promise<void>;
  setDisabled: (isDisabled: boolean) => void;
  setDragging: (isDragging: boolean) => void;
  destroy: () => void;
}

let multiItemSeq = 0;

function mapDataToItem(data: UploadedImageData, idx: number): VueMultiUploadItem {
  multiItemSeq += 1;
  return {
    id: `item-${idx}-${multiItemSeq}`,
    url: data.url, data, altText: data.altText, blurColor: data.blurColor,
    isUploading: false, progress: 100, originalSize: data.originalSize, optimizedSize: data.size,
  };
}

export function useMultiUpload<TPreset extends string = UploadPresetName>(
  options: VueMultiUploadOptions<TPreset> = {},
): VueMultiUploadController {
  const baseConfig = getCurrentInstance() ? useImageUploadConfig() : undefined;
  const getEnv = () => resolveControllerEnv(options, baseConfig);
  const initialEnv = getEnv();
  const getMaxFiles = () => options.maxFiles ?? options.maxImages ?? 999;
  const getMaxParallel = () => options.maxParallelUploads ?? 2;

  const initialValue = options.value ?? [];
  const items = ref<VueMultiUploadItem[]>(initialValue.map((d, i) => mapDataToItem(d, i)));
  const error = ref<string>(options.error ?? '');
  const liveAnnouncement = ref<string>('');
  const disabled = ref<boolean>(Boolean(options.disabled));
  const isDragging = ref<boolean>(false);
  const quality = ref<QualityLevel>(initialEnv.initQualityLevel);
  const tracker = createUploadTracker<File>();
  let destroyed = false;

  const value = computed<UploadedImageData[]>(() =>
    items.value.filter((i) => Boolean(i.data) && !i.isUploading).map((i) => i.data!),
  );
  const isUploading = computed<boolean>(() => items.value.some((i) => i.isUploading));
  const progress = computed<number>(() => {
    const list = items.value;
    if (!isUploading.value || list.length === 0) return 0;
    return Math.round(list.reduce((acc, i) => acc + (i.progress || 0), 0) / list.length);
  });
  const canAddMore = computed<boolean>(
    () => !disabled.value && items.value.filter((i) => !i.error).length < getMaxFiles(),
  );
  const state = computed<UploadVisualState>(() =>
    computeVisualState({
      disabled: disabled.value, isDragging: isDragging.value, isUploading: isUploading.value,
      hasError: Boolean(error.value) || items.value.some((i) => Boolean(i.error)),
      hasContent: items.value.length > 0,
    }),
  );
  const missingAltCount = computed<number>(() =>
    getEnv().requireAltText
      ? items.value.filter((i) => Boolean(i.data) && !i.isUploading && !(i.altText ?? i.data?.altText ?? '').trim()).length
      : 0,
  );
  const canSave = computed<boolean>(
    () => value.value.length >= (options.minImages ?? 1) && !isUploading.value && missingAltCount.value === 0,
  );
  const emitChange = () => { options.onChange?.(value.value); };
  const patchItem = (id: string, updater: (prev: VueMultiUploadItem) => VueMultiUploadItem, emit = false) => {
    items.value = items.value.map((item) => (item.id === id ? updater(item) : item));
    if (emit) emitChange();
  };

  const uploadSingleItem = async (itemId: string, rawFile: File, idx: number): Promise<UploadedImageData | null> => {
    const env = getEnv();
    const entry = tracker.createEntry(rawFile, env.ui.uploading, itemId);
    try {
      const prepared = await prepareAndValidateAsset({ file: rawFile, env, options, signal: entry.controller.signal, index: idx });
      if (prepared.error || !prepared.file) {
        tracker.removeEntry(itemId);
        const errMsg = prepared.error ?? env.ui.uploadFailed;
        patchItem(itemId, (it) => ({ ...it, isUploading: false, progress: 0, error: errMsg }));
        error.value = errMsg; options.onError?.(errMsg);
        return null;
      }
      const workingFile = prepared.file;
      const uploaded = await executeUploadRequest({
        file: workingFile, env, options, qualityLevel: quality.value, signal: entry.controller.signal,
        onUploadProgress: (pct) => {
          if (destroyed || entry.controller.signal.aborted) return;
          patchItem(itemId, (it) => ({ ...it, progress: Math.max(it.progress, Math.min(94, pct)), isUploading: true }));
        },
      });
      tracker.removeEntry(itemId);
      if (destroyed || entry.controller.signal.aborted) return null;
      patchItem(itemId, (it) => {
        revokeBlobUrl(it.url);
        const resolvedAlt = it.altText || uploaded.altText;
        const resolvedColor = it.blurColor || uploaded.blurColor;
        const mergedData: UploadedImageData = { ...uploaded, altText: resolvedAlt, blurColor: resolvedColor };
        return {
          ...it, url: mergedData.url, file: undefined, data: mergedData, blurColor: resolvedColor,
          altText: resolvedAlt, originalSize: workingFile.size,
          optimizedSize: mergedData.size, isUploading: false, progress: 100, error: undefined,
        };
      }, true);
      return uploaded;
    } catch (err) {
      tracker.removeEntry(itemId);
      if (destroyed || entry.controller.signal.aborted || isUploadAbortError(err)) return null;
      const msg = err instanceof Error ? err.message : env.ui.uploadFailed;
      patchItem(itemId, (it) => ({ ...it, isUploading: false, progress: 0, error: msg }));
      error.value = msg; options.onError?.(msg);
      return null;
    }
  };

  const addFiles = async (files: FileList | File[]): Promise<UploadedImageData[]> => {
    if (destroyed || disabled.value) return [];
    const incoming = Array.from(files);
    if (incoming.length === 0) return [];
    const env = getEnv();
    error.value = '';
    const activeCount = items.value.filter((i) => !i.error).length;
    const batchErr = validateMultipleFiles(incoming, env.maxSizeMB, activeCount, getMaxFiles(), env.locale);
    if (batchErr) { error.value = batchErr; options.onError?.(batchErr); return []; }

    const baseIndex = items.value.length;
    const queued = incoming.map((file, i) => {
      multiItemSeq += 1;
      const item: VueMultiUploadItem = {
        id: `multi-${Date.now()}-${multiItemSeq}`, url: createBlobPreview(file),
        file, fileName: file.name, originalSize: file.size, isUploading: true, progress: 0,
      };
      return { item, queueIndex: baseIndex + i };
    });
    items.value = [...items.value, ...queued.map((q) => q.item)];
    liveAnnouncement.value = env.ui.uploadStartedLive;
    options.onUploadStart?.(incoming);

    const results: UploadedImageData[] = [];
    await runParallelUploadPool(queued, getMaxParallel(), async ({ item: qItem, queueIndex }) => {
      if (!items.value.some((i) => i.id === qItem.id) || !qItem.file) return;
      const res = await uploadSingleItem(qItem.id, qItem.file, queueIndex);
      if (res) results.push(res);
    });
    if (!destroyed) {
      liveAnnouncement.value = env.ui.uploadCompleteLive;
      if (results.length > 0) options.onUploadComplete?.(results);
    }
    return results;
  };

  const removeItem = async (id: string): Promise<void> => {
    const target = items.value.find((i) => i.id === id);
    if (!target) return;
    const env = getEnv();
    tracker.abortByIdOrFile(id);
    revokeBlobUrl(target.url);
    items.value = items.value.filter((i) => i.id !== id);
    emitChange();
    if (target.data) await executeDeleteRequest(target.data, env, options);
  };

  const cancelItem = (id: string): void => {
    const target = items.value.find((i) => i.id === id);
    if (!target) return;
    tracker.abortByIdOrFile(id);
    revokeBlobUrl(target.url);
    items.value = items.value.filter((i) => i.id !== id);
    emitChange();
    options.onUploadCancel?.(id);
  };

  const retryItem = async (id: string): Promise<void> => {
    const idx = items.value.findIndex((i) => i.id === id && i.file);
    const target = idx >= 0 ? items.value[idx] : undefined;
    if (!target?.file) return;
    error.value = '';
    patchItem(id, (it) => ({ ...it, error: undefined, isUploading: true, progress: 0 }));
    await uploadSingleItem(id, target.file, idx);
  };

  const retryFailed = async (): Promise<void> => {
    const failedIds = items.value.filter((i) => Boolean(i.error && i.file)).map((i) => i.id);
    for (const id of failedIds) await retryItem(id);
  };

  const move = (fromIndex: number, toIndex: number): void => {
    const current = items.value;
    if (current.length <= 1 || fromIndex === toIndex) return;
    const next = moveItem(current, fromIndex, toIndex);
    items.value = next;
    liveAnnouncement.value = getEnv().ui.reorderedAnnouncement
      .replace('{pos}', String(toIndex + 1)).replace('{total}', String(next.length));
    emitChange();
    options.onReorder?.(value.value, { fromIndex, toIndex });
  };

  const setCover = (index: number): void => {
    const current = items.value;
    if (index <= 0 || index >= current.length) return;
    const next = promoteToCover(current, index);
    items.value = next;
    liveAnnouncement.value = getEnv().ui.coverSetAnnouncement.replace('{total}', String(next.length));
    emitChange();
    options.onReorder?.(value.value, { fromIndex: index, toIndex: 0 });
  };

  const destroy = () => {
    destroyed = true; tracker.abortAll();
    for (const item of items.value) revokeBlobUrl(item.url);
  };
  if (getCurrentScope()) onScopeDispose(destroy);

  return {
    items, value, isUploading, progress, error, liveAnnouncement, canAddMore,
    disabled, state, quality, missingAltCount, canSave,
    get reorderable() { return options.reorderable ?? true; },
    get showCoverBadge() { return options.showCoverBadge ?? true; },
    get coverBadgeLabel() { return options.coverBadgeLabel ?? getEnv().ui.coverBadge; },
    addFiles, removeItem, cancelItem, retryItem, retryAll: retryFailed, retryFailed,
    setItemAltText: (id: string, alt: string) => {
      patchItem(id, (it) => ({ ...it, altText: alt, data: it.data ? { ...it.data, altText: alt } : undefined }), true);
    },
    setItemBlurColor: (id: string, color: string) => {
      const normalized = normalizeColorInput(color);
      if (!normalized) return;
      patchItem(id, (it) => ({ ...it, blurColor: normalized, data: it.data ? { ...it.data, blurColor: normalized } : undefined }), true);
    },
    move, setCover, setPrimary: setCover,
    setValue: (val: UploadedImageData[]) => {
      const inFlight = items.value.filter((i) => i.isUploading);
      for (const item of items.value) { if (!item.isUploading) revokeBlobUrl(item.url); }
      const mapped = (Array.isArray(val) ? val : []).map((d, i) => mapDataToItem(d, i));
      items.value = [...mapped, ...inFlight];
      error.value = '';
    },
    clearAll: async () => {
      const env = getEnv();
      tracker.abortAll();
      const existing = [...items.value];
      for (const item of existing) revokeBlobUrl(item.url);
      items.value = [];
      error.value = '';
      emitChange();
      for (const item of existing) {
        if (item.data) await executeDeleteRequest(item.data, env, options);
      }
    },
    setDisabled: (isDisabled: boolean) => { disabled.value = isDisabled; },
    setDragging: (dragging: boolean) => { isDragging.value = dragging; },
    destroy,
  };
}
