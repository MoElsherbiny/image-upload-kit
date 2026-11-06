import {
  createUploadTracker, isUploadAbortError, moveItem, promoteToCover, runParallelUploadPool,
} from '../../client';
import type { UploadTranslations } from '../../i18n';
import type {
  QualityLevel, UploadedImageData, UploadLocale, UploadPresetName,
} from '../../types';
import { validateMultipleFiles } from '../../utils/validators';
import { createSignal } from '../signals';
import type {
  AngularMultiUploadItem, AngularMultiUploadOptions, AngularSignal,
  ControlValueAccessorShape, UploadVisualState,
} from '../types';
import {
  applyItemAltText, applyItemBlurColor, collectCompletedItems,
  countMissingAltItems, createQueuedMultiItem, mapDataToItem, resolveNormalizedColor,
} from './multiUploadOps';
import {
  computeVisualState, executeDeleteRequest, executeUploadRequest,
  prepareAndValidateAsset, resolveControllerEnv, revokeBlobUrl,
} from './uploadHelpers';

export interface AngularMultiUploadController {
  items: AngularSignal<AngularMultiUploadItem[]>;
  value: AngularSignal<UploadedImageData[]>;
  isUploading: AngularSignal<boolean>;
  progress: AngularSignal<number>;
  error: AngularSignal<string>;
  liveAnnouncement: AngularSignal<string>;
  canAddMore: AngularSignal<boolean>;
  missingAltCount: AngularSignal<number>;
  canSave: AngularSignal<boolean>;
  disabled: AngularSignal<boolean>;
  state: AngularSignal<UploadVisualState>;
  quality: AngularSignal<QualityLevel>;
  locale: UploadLocale;
  ui: UploadTranslations;
  reorderable: boolean;
  showCoverBadge: boolean;
  coverBadgeLabel: string;
  addFiles: (files: FileList | File[]) => Promise<UploadedImageData[]>;
  removeItem: (id: string) => Promise<void>;
  cancelItem: (id: string) => void;
  retryItem: (id: string) => Promise<void>;
  retryFailed: () => Promise<void>;
  retryAll: () => Promise<void>;
  setItemAltText: (id: string, altText: string) => void;
  setItemBlurColor: (id: string, color: string) => void;
  move: (fromIndex: number, toIndex: number) => void;
  setCover: (index: number) => void;
  setPrimary: (index: number) => void;
  clearAll: () => void;
  setDisabled: (isDisabled: boolean) => void;
  setDragging: (isDragging: boolean) => void;
  markAsTouched: () => void;
  toControlValueAccessor: () => ControlValueAccessorShape<UploadedImageData[]>;
  destroy: () => void;
}

export function createMultiUpload<TPreset extends string = UploadPresetName>(
  options: AngularMultiUploadOptions<TPreset> = {},
): AngularMultiUploadController {
  const env = resolveControllerEnv(options);
  const maxFiles = options.maxFiles ?? options.maxImages ?? 999;
  const maxParallel = options.maxParallelUploads ?? 2;
  const reorderable = options.reorderable ?? true;
  const showCoverBadge = options.showCoverBadge ?? true;
  const coverBadgeLabel = options.coverBadgeLabel ?? env.ui.coverBadge;

  const initialValue = options.value ?? [];
  const items = createSignal<AngularMultiUploadItem[]>(initialValue.map((d, i) => mapDataToItem(d, i)));
  const value = createSignal<UploadedImageData[]>([...initialValue]);
  const isUploading = createSignal<boolean>(false);
  const progress = createSignal<number>(0);
  const error = createSignal<string>(options.error ?? '');
  const liveAnnouncement = createSignal<string>('');
  const canAddMore = createSignal<boolean>(initialValue.length < maxFiles);
  const missingAltCount = createSignal<number>(0);
  const canSave = createSignal<boolean>(false);
  const disabled = createSignal<boolean>(Boolean(options.disabled));
  const state = createSignal<UploadVisualState>('idle');
  const quality = createSignal<QualityLevel>(env.initQualityLevel);

  const tracker = createUploadTracker<File>();
  let isDragging = false;
  let destroyed = false;
  let cvaOnChange: ((val: UploadedImageData[]) => void) | null = null;
  let cvaOnTouched: (() => void) | null = null;

  const syncDerived = (emit = false) => {
    const list = items();
    const uploading = list.some((i) => i.isUploading);
    const hasFailed = list.some((i) => Boolean(i.error));
    const requireAlt = Boolean(env.cfg.requireAltText);
    const missingAlt = countMissingAltItems(list, requireAlt);

    isUploading.set(uploading);
    missingAltCount.set(missingAlt);
    canSave.set(!uploading && !hasFailed && (!requireAlt || missingAlt === 0));
    canAddMore.set(!disabled() && list.filter((i) => !i.error).length < maxFiles);
    const totalPct = list.reduce((acc, i) => acc + (i.progress || 0), 0);
    progress.set(uploading && list.length > 0 ? Math.round(totalPct / list.length) : 0);
    const completed = collectCompletedItems(list);
    value.set(completed);
    state.set(computeVisualState({
      disabled: disabled(), isDragging, isUploading: uploading,
      hasError: Boolean(error()) || hasFailed, hasContent: list.length > 0,
    }));
    if (emit) { options.onChange?.(completed); cvaOnChange?.(completed); }
  };
  syncDerived(false);

  const patchItem = (
    id: string, updater: (prev: AngularMultiUploadItem) => AngularMultiUploadItem, emit = false,
  ) => {
    items.update((list) => list.map((item) => (item.id === id ? updater(item) : item)));
    syncDerived(emit);
  };

  const uploadSingleItem = async (
    itemId: string, rawFile: File, idx: number,
  ): Promise<UploadedImageData | null> => {
    const entry = tracker.createEntry(rawFile, env.ui.preparingUpload, itemId);
    try {
      const prepared = await prepareAndValidateAsset({
        file: rawFile, env, options, signal: entry.controller.signal, index: idx,
      });
      if (prepared.error || !prepared.file) {
        tracker.removeEntry(itemId);
        const errMsg = prepared.error ?? env.ui.uploadFailed;
        patchItem(itemId, (it) => ({ ...it, isUploading: false, progress: 0, error: errMsg }));
        error.set(errMsg);
        options.onError?.(errMsg);
        return null;
      }
      const workingFile = prepared.file;
      patchItem(itemId, (it) => ({ ...it, uploadMessage: env.ui.preparingUpload }));
      const uploaded = await executeUploadRequest({
        file: workingFile, env, options, qualityLevel: quality(), signal: entry.controller.signal,
        onUploadProgress: (pct) => {
          if (destroyed || entry.controller.signal.aborted) return;
          patchItem(itemId, (it) => ({
            ...it, progress: Math.max(it.progress, Math.min(94, pct)), isUploading: true,
          }));
        },
      });
      tracker.removeEntry(itemId);
      if (destroyed || entry.controller.signal.aborted) return null;
      patchItem(itemId, (it) => {
        revokeBlobUrl(it.url);
        return {
          ...it, url: uploaded.url, data: uploaded, file: undefined, blurColor: uploaded.blurColor,
          altText: it.altText || uploaded.altText, originalSize: workingFile.size,
          optimizedSize: uploaded.size, isUploading: false, progress: 100,
          error: undefined, uploadMessage: null,
        };
      }, true);
      return uploaded;
    } catch (err) {
      tracker.removeEntry(itemId);
      if (destroyed || entry.controller.signal.aborted || isUploadAbortError(err)) return null;
      const msg = err instanceof Error ? err.message : env.ui.uploadFailed;
      patchItem(itemId, (it) => ({ ...it, isUploading: false, progress: 0, error: msg }));
      error.set(msg);
      options.onError?.(msg);
      return null;
    }
  };

  const addFiles = async (files: FileList | File[]): Promise<UploadedImageData[]> => {
    if (destroyed || disabled()) return [];
    const incoming = Array.from(files);
    if (incoming.length === 0) return [];
    error.set('');
    const existingList = items();
    const existingCount = existingList.length;
    const activeCount = existingList.filter((i) => !i.error).length;
    const batchErr = validateMultipleFiles(incoming, env.maxSizeMB, activeCount, maxFiles, env.locale);
    if (batchErr) { error.set(batchErr); syncDerived(false); options.onError?.(batchErr); return []; }

    const initMsg = options.transformAsset ? env.ui.transforming : env.ui.preparingUpload;
    const queued = incoming.map((file, idx) => createQueuedMultiItem(file, existingCount + idx, initMsg));
    items.set([...existingList, ...queued]);
    liveAnnouncement.set(env.ui.uploadStartedLive);
    syncDerived(false);
    options.onUploadStart?.(incoming);

    const results: UploadedImageData[] = [];
    await runParallelUploadPool(queued, maxParallel, async (qItem) => {
      if (!items().some((i) => i.id === qItem.id) || !qItem.file) return;
      const res = await uploadSingleItem(qItem.id, qItem.file, qItem.queueIndex ?? 0);
      if (res) results.push(res);
    });
    if (!destroyed) {
      liveAnnouncement.set(env.ui.uploadCompleteLive);
      syncDerived(false);
      if (results.length > 0) options.onUploadComplete?.(results);
    }
    return results;
  };

  const removeItem = async (id: string): Promise<void> => {
    const target = items().find((i) => i.id === id);
    if (!target) return;
    tracker.abortByIdOrFile(id);
    revokeBlobUrl(target.url);
    items.set(items().filter((i) => i.id !== id));
    syncDerived(true);
    if (target.data) await executeDeleteRequest(target.data, env);
  };

  const cancelItem = (id: string): void => {
    if (!items().some((i) => i.id === id)) return;
    tracker.abortByIdOrFile(id);
    revokeBlobUrl(items().find((i) => i.id === id)?.url);
    items.set(items().filter((i) => i.id !== id));
    syncDerived(true);
    options.onUploadCancel?.(id);
  };

  const retryItem = async (id: string): Promise<void> => {
    const target = items().find((i) => i.id === id && i.file);
    if (!target?.file) return;
    error.set('');
    patchItem(id, (it) => ({ ...it, error: undefined, isUploading: true, progress: 0 }));
    await uploadSingleItem(id, target.file, target.queueIndex ?? 0);
  };

  const retryFailed = async (): Promise<void> => {
    const failed = items().filter((i) => Boolean(i.error && i.file));
    if (failed.length === 0) return;
    error.set('');
    await runParallelUploadPool(failed, maxParallel, async (it) => { await retryItem(it.id); });
  };

  const move = (fromIndex: number, toIndex: number): void => {
    const current = items();
    if (current.length <= 1 || fromIndex === toIndex) return;
    const next = moveItem(current, fromIndex, toIndex);
    items.set(next);
    liveAnnouncement.set(
      env.ui.reorderedAnnouncement.replace('{pos}', String(toIndex + 1)).replace('{total}', String(next.length)),
    );
    syncDerived(true);
    options.onReorder?.(value(), { fromIndex, toIndex });
  };

  const setCover = (index: number): void => {
    const current = items();
    if (index <= 0 || index >= current.length) return;
    const next = promoteToCover(current, index);
    items.set(next);
    liveAnnouncement.set(env.ui.coverSetAnnouncement.replace('{total}', String(next.length)));
    syncDerived(true);
    options.onReorder?.(value(), { fromIndex: index, toIndex: 0 });
  };

  const clearAll = (): void => {
    tracker.abortAll();
    for (const item of items()) revokeBlobUrl(item.url);
    items.set([]);
    error.set('');
    syncDerived(true);
  };

  return {
    items, value, isUploading, progress, error, liveAnnouncement, canAddMore,
    missingAltCount, canSave, disabled, state, quality, locale: env.locale, ui: env.ui,
    reorderable, showCoverBadge, coverBadgeLabel,
    addFiles, removeItem, cancelItem, retryItem, retryFailed, retryAll: retryFailed,
    setItemAltText: (id: string, altText: string) => patchItem(id, (it) => applyItemAltText(it, altText), true),
    setItemBlurColor: (id: string, color: string) => {
      const norm = resolveNormalizedColor(color);
      if (norm) patchItem(id, (it) => applyItemBlurColor(it, norm), true);
    },
    move, setCover, setPrimary: setCover, clearAll,
    setDisabled: (isDisabled: boolean) => { disabled.set(isDisabled); syncDerived(false); },
    setDragging: (dragging: boolean) => { isDragging = dragging; syncDerived(false); },
    markAsTouched: () => { cvaOnTouched?.(); options.onBlur?.(); },
    toControlValueAccessor: () => ({
      writeValue: (val: UploadedImageData[]) => {
        for (const item of items()) revokeBlobUrl(item.url);
        const safe = Array.isArray(val) ? val : [];
        items.set(safe.map((d, i) => mapDataToItem(d, i)));
        error.set('');
        syncDerived(false);
      },
      registerOnChange: (fn) => { cvaOnChange = fn; },
      registerOnTouched: (fn) => { cvaOnTouched = fn; },
      setDisabledState: (isDisabled: boolean) => { disabled.set(isDisabled); syncDerived(false); },
    }),
    destroy: () => {
      destroyed = true;
      tracker.abortAll();
      for (const item of items()) revokeBlobUrl(item.url);
    },
  };
}
