import {
  createUploadTracker, isUploadAbortError, moveItem, promoteToCover, runParallelUploadPool,
} from '../../client';
import type { QualityLevel, UploadedImageData, UploadPresetName } from '../../types';
import { validateMultipleFiles } from '../../utils/validators';
import { createSignal } from '../signals';
import type {
  AngularMultiUploadItem, AngularMultiUploadOptions, AngularSignal,
  ControlValueAccessorShape, UploadVisualState,
} from '../types';
import {
  computeVisualState, createBlobPreview, executeUploadRequest,
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
  disabled: AngularSignal<boolean>;
  state: AngularSignal<UploadVisualState>;
  quality: AngularSignal<QualityLevel>;
  reorderable: boolean;
  showCoverBadge: boolean;
  coverBadgeLabel: string;
  addFiles: (files: FileList | File[]) => Promise<UploadedImageData[]>;
  removeItem: (id: string) => Promise<void>;
  cancelItem: (id: string) => void;
  retryItem: (id: string) => Promise<void>;
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

let multiItemSeq = 0;

function mapDataToItem(data: UploadedImageData, idx: number): AngularMultiUploadItem {
  multiItemSeq += 1;
  return {
    id: data.contentHash || `item-${idx}-${multiItemSeq}`,
    url: data.url, data, altText: data.altText, blurColor: data.blurColor,
    isUploading: false, progress: 100, originalSize: data.originalSize, optimizedSize: data.size,
  };
}

export function createMultiUpload<TPreset extends string = UploadPresetName>(
  options: AngularMultiUploadOptions<TPreset> = {},
): AngularMultiUploadController {
  const env = resolveControllerEnv(options);
  const maxFiles = options.maxFiles ?? options.maxImages ?? 999;
  const maxParallel = options.maxParallelUploads ?? 2;
  const reorderable = options.reorderable ?? true;
  const showCoverBadge = options.showCoverBadge ?? true;
  const coverBadgeLabel = options.coverBadgeLabel ?? (env.locale === 'ar' ? 'غلاف' : 'Cover');

  const initialValue = options.value ?? [];
  const items = createSignal<AngularMultiUploadItem[]>(initialValue.map((d, i) => mapDataToItem(d, i)));
  const value = createSignal<UploadedImageData[]>([...initialValue]);
  const isUploading = createSignal<boolean>(false);
  const progress = createSignal<number>(0);
  const error = createSignal<string>(options.error ?? '');
  const liveAnnouncement = createSignal<string>('');
  const canAddMore = createSignal<boolean>(initialValue.length < maxFiles);
  const disabled = createSignal<boolean>(Boolean(options.disabled));
  const state = createSignal<UploadVisualState>('idle');
  const quality = createSignal<QualityLevel>(env.initQualityLevel);

  const tracker = createUploadTracker<File>();
  let isDragging = false;
  let destroyed = false;
  let cvaOnChange: ((val: UploadedImageData[]) => void) | null = null;
  let cvaOnTouched: (() => void) | null = null;

  const collectCompleted = (list: AngularMultiUploadItem[]): UploadedImageData[] =>
    list.filter((i) => Boolean(i.data) && !i.isUploading).map((i) => i.data!);

  const syncDerived = (emit = false) => {
    const list = items();
    const uploading = list.some((i) => i.isUploading);
    isUploading.set(uploading);
    const activeCount = list.filter((i) => !i.error).length;
    canAddMore.set(!disabled() && activeCount < maxFiles);
    const totalPct = list.reduce((acc, i) => acc + (i.progress || 0), 0);
    progress.set(uploading && list.length > 0 ? Math.round(totalPct / list.length) : 0);
    const completed = collectCompleted(list);
    value.set(completed);
    state.set(
      computeVisualState({
        disabled: disabled(), isDragging, isUploading: uploading,
        hasError: Boolean(error()) || list.some((i) => Boolean(i.error)),
        hasContent: list.length > 0,
      }),
    );
    if (emit) {
      options.onChange?.(completed);
      cvaOnChange?.(completed);
    }
  };
  syncDerived(false);

  const patchItem = (
    id: string,
    updater: (prev: AngularMultiUploadItem) => AngularMultiUploadItem,
    emit = false,
  ) => {
    items.update((list) => list.map((item) => (item.id === id ? updater(item) : item)));
    syncDerived(emit);
  };

  const uploadSingleItem = async (
    itemId: string, rawFile: File, idx: number,
  ): Promise<UploadedImageData | null> => {
    const entry = tracker.createEntry(rawFile, 'Uploading...', itemId);
    try {
      const prepared = await prepareAndValidateAsset({
        file: rawFile, env, options, signal: entry.controller.signal, index: idx,
      });
      if (prepared.error || !prepared.file) {
        tracker.removeEntry(itemId);
        const errMsg = prepared.error ?? 'Invalid file';
        patchItem(itemId, (it) => ({ ...it, isUploading: false, progress: 0, error: errMsg }));
        error.set(errMsg);
        options.onError?.(errMsg);
        return null;
      }
      const workingFile = prepared.file;
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
          ...it, url: uploaded.url, data: uploaded, blurColor: uploaded.blurColor,
          altText: it.altText || uploaded.altText, originalSize: workingFile.size,
          optimizedSize: uploaded.size, isUploading: false, progress: 100, error: undefined,
        };
      }, true);
      return uploaded;
    } catch (err) {
      tracker.removeEntry(itemId);
      if (destroyed || entry.controller.signal.aborted || isUploadAbortError(err)) return null;
      const msg = err instanceof Error ? err.message : 'Upload failed';
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
    const activeCount = items().filter((i) => !i.error).length;
    const batchErr = validateMultipleFiles(incoming, env.maxSizeMB, activeCount, maxFiles, env.locale);
    if (batchErr) { error.set(batchErr); syncDerived(false); options.onError?.(batchErr); return []; }

    const queued: AngularMultiUploadItem[] = incoming.map((file) => {
      multiItemSeq += 1;
      return {
        id: `multi-${Date.now()}-${multiItemSeq}`, url: createBlobPreview(file),
        file, fileName: file.name, originalSize: file.size, isUploading: true, progress: 0,
      };
    });
    items.set([...items(), ...queued]);
    liveAnnouncement.set('Upload started');
    syncDerived(false);
    options.onUploadStart?.(incoming);

    const results: UploadedImageData[] = [];
    await runParallelUploadPool(queued, maxParallel, async (qItem) => {
      if (!items().some((i) => i.id === qItem.id) || !qItem.file) return;
      const res = await uploadSingleItem(qItem.id, qItem.file, results.length);
      if (res) results.push(res);
    });
    if (!destroyed) {
      liveAnnouncement.set('Upload complete');
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
    if (target.data && env.cfg.customDeleter) await env.cfg.customDeleter(target.data);
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
    patchItem(id, (it) => ({ ...it, error: undefined, isUploading: true, progress: 0 }));
    await uploadSingleItem(id, target.file, 0);
  };

  const move = (fromIndex: number, toIndex: number): void => {
    const current = items();
    if (current.length <= 1 || fromIndex === toIndex) return;
    items.set(moveItem(current, fromIndex, toIndex));
    liveAnnouncement.set(`Moved image to position ${toIndex + 1}`);
    syncDerived(true);
    options.onReorder?.(value(), { fromIndex, toIndex });
  };

  const setCover = (index: number): void => {
    const current = items();
    if (index <= 0 || index >= current.length) return;
    items.set(promoteToCover(current, index));
    liveAnnouncement.set('Promoted image to cover');
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
    disabled, state, quality, reorderable, showCoverBadge, coverBadgeLabel,
    addFiles, removeItem, cancelItem, retryItem, move, setCover, setPrimary: setCover, clearAll,
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
