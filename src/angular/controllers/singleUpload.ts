import { createUploadTracker, isUploadAbortError } from '../../client';
import type { QualityLevel, UploadedImageData, UploadPresetName } from '../../types';
import { DEFAULT_BLUR_COLOR, normalizeColorInput } from '../../utils/color';
import { createSuccessMessage, getStatusMessage } from '../../utils/formatters';
import { createSignal } from '../signals';
import type {
  AngularSignal, AngularSingleUploadOptions, ControlValueAccessorShape, UploadVisualState,
} from '../types';
import {
  computeVisualState, createBlobPreview, executeUploadRequest,
  prepareAndValidateAsset, resolveControllerEnv, revokeBlobUrl,
} from './uploadHelpers';

export interface AngularSingleUploadController {
  value: AngularSignal<UploadedImageData | null>;
  previewUrl: AngularSignal<string | null>;
  isUploading: AngularSignal<boolean>;
  progress: AngularSignal<number>;
  uploadStatus: AngularSignal<string>;
  error: AngularSignal<string>;
  quality: AngularSignal<QualityLevel>;
  altText: AngularSignal<string>;
  blurColor: AngularSignal<string>;
  disabled: AngularSignal<boolean>;
  state: AngularSignal<UploadVisualState>;
  selectFile: (file: File) => Promise<UploadedImageData | null>;
  cancel: () => void;
  retry: () => Promise<UploadedImageData | null>;
  clear: () => Promise<void>;
  setAltText: (alt: string) => void;
  setBlurColor: (color: string) => void;
  setQuality: (q: QualityLevel) => void;
  setDisabled: (isDisabled: boolean) => void;
  setDragging: (isDragging: boolean) => void;
  markAsTouched: () => void;
  toControlValueAccessor: () => ControlValueAccessorShape<UploadedImageData | null>;
  destroy: () => void;
}

export function createSingleUpload<TPreset extends string = UploadPresetName>(
  options: AngularSingleUploadOptions<TPreset> = {},
): AngularSingleUploadController {
  const env = resolveControllerEnv(options);
  const initialObj =
    typeof options.value === 'object' && options.value ? options.value : null;
  const initialPreview =
    typeof options.value === 'string' ? options.value : (initialObj?.url ?? null);

  const value = createSignal<UploadedImageData | null>(initialObj);
  const previewUrl = createSignal<string | null>(initialPreview);
  const isUploading = createSignal<boolean>(false);
  const progress = createSignal<number>(0);
  const uploadStatus = createSignal<string>('');
  const error = createSignal<string>(options.error ?? '');
  const quality = createSignal<QualityLevel>(env.initQualityLevel);
  const altText = createSignal<string>(
    initialObj?.altText ?? options.initialAltText ?? '',
  );
  const blurColor = createSignal<string>(
    initialObj?.blurColor ?? DEFAULT_BLUR_COLOR,
  );
  const disabled = createSignal<boolean>(Boolean(options.disabled));
  const state = createSignal<UploadVisualState>('idle');

  const tracker = createUploadTracker<File>();
  let isDragging = false;
  let destroyed = false;
  let lastSelectedFile: File | null = null;
  let cvaOnChange: ((val: UploadedImageData | null) => void) | null = null;
  let cvaOnTouched: (() => void) | null = null;

  const syncState = () => {
    state.set(
      computeVisualState({
        disabled: disabled(),
        isDragging,
        isUploading: isUploading(),
        hasError: Boolean(error()),
        hasContent: Boolean(previewUrl() || value()),
      }),
    );
  };
  syncState();

  const emitChange = (next: UploadedImageData | null) => {
    options.onChange?.(next);
    cvaOnChange?.(next);
  };

  const failWith = (msg: string): null => {
    isUploading.set(false);
    progress.set(0);
    uploadStatus.set('');
    error.set(msg);
    syncState();
    options.onError?.(msg);
    return null;
  };

  const selectFile = async (file: File): Promise<UploadedImageData | null> => {
    if (destroyed || disabled()) return null;
    lastSelectedFile = file;
    tracker.abortAll();
    error.set('');

    const entry = tracker.createEntry(file, 'Preparing upload...');
    isUploading.set(true);
    progress.set(0);
    uploadStatus.set('Preparing upload...');
    syncState();

    try {
      const prepared = await prepareAndValidateAsset({
        file,
        env,
        options,
        signal: entry.controller.signal,
        index: 0,
      });
      if (prepared.error || !prepared.file) {
        tracker.removeEntry(entry.id);
        return failWith(prepared.error ?? 'Invalid file');
      }
      const workingFile = prepared.file;

      const blobUrl = createBlobPreview(workingFile);
      if (blobUrl) {
        revokeBlobUrl(previewUrl());
        previewUrl.set(blobUrl);
      }

      options.onUploadStart?.(workingFile);
      const uploaded = await executeUploadRequest({
        file: workingFile,
        env,
        options,
        qualityLevel: quality(),
        altText: altText(),
        signal: entry.controller.signal,
        onUploadProgress: (pct) => {
          if (destroyed || entry.controller.signal.aborted) return;
          const clamped = Math.max(progress(), Math.min(94, pct));
          progress.set(clamped);
          uploadStatus.set(getStatusMessage(clamped, env.locale));
        },
      });

      tracker.removeEntry(entry.id);
      if (destroyed || entry.controller.signal.aborted) return null;

      const resolvedColor = uploaded.blurColor || blurColor() || DEFAULT_BLUR_COLOR;
      const resolvedAlt = altText() || uploaded.altText || '';
      const payload: UploadedImageData = {
        ...uploaded,
        altText: resolvedAlt,
        blurColor: resolvedColor,
      };

      revokeBlobUrl(previewUrl());
      previewUrl.set(payload.url);
      altText.set(resolvedAlt);
      blurColor.set(resolvedColor);
      value.set(payload);
      isUploading.set(false);
      progress.set(100);
      uploadStatus.set(
        createSuccessMessage(workingFile.size, payload.size, false, env.locale),
      );
      syncState();
      emitChange(payload);
      options.onUploadComplete?.(payload);
      return payload;
    } catch (err) {
      tracker.removeEntry(entry.id);
      if (destroyed || entry.controller.signal.aborted || isUploadAbortError(err)) {
        isUploading.set(false);
        progress.set(0);
        uploadStatus.set('');
        syncState();
        return null;
      }
      const msg = err instanceof Error ? err.message : 'Upload failed';
      revokeBlobUrl(previewUrl());
      previewUrl.set(value()?.url ?? null);
      return failWith(msg);
    }
  };

  const cancel = () => {
    tracker.abortAll();
    revokeBlobUrl(previewUrl());
    previewUrl.set(value()?.url ?? null);
    isUploading.set(false);
    progress.set(0);
    uploadStatus.set('');
    syncState();
  };

  const clear = async (): Promise<void> => {
    tracker.abortAll();
    const current = value();
    revokeBlobUrl(previewUrl());
    previewUrl.set(null);
    value.set(null);
    altText.set('');
    blurColor.set(DEFAULT_BLUR_COLOR);
    error.set('');
    isUploading.set(false);
    progress.set(0);
    uploadStatus.set('');
    syncState();
    if (current && env.cfg.customDeleter) await env.cfg.customDeleter(current);
    emitChange(null);
  };

  return {
    value, previewUrl, isUploading, progress, uploadStatus, error, quality, altText, blurColor,
    disabled, state, selectFile, cancel,
    retry: () => (lastSelectedFile ? selectFile(lastSelectedFile) : Promise.resolve(null)),
    clear,
    setAltText: (nextAlt: string) => {
      altText.set(nextAlt);
      const curr = value();
      if (curr) { const updated = { ...curr, altText: nextAlt }; value.set(updated); emitChange(updated); }
    },
    setBlurColor: (nextColor: string) => {
      const normalized = normalizeColorInput(nextColor);
      if (!normalized) return;
      blurColor.set(normalized);
      const curr = value();
      if (curr) { const updated = { ...curr, blurColor: normalized }; value.set(updated); emitChange(updated); }
    },
    setQuality: (q: QualityLevel) => quality.set(q),
    setDisabled: (isDisabled: boolean) => { disabled.set(isDisabled); syncState(); },
    setDragging: (dragging: boolean) => { isDragging = dragging; syncState(); },
    markAsTouched: () => { cvaOnTouched?.(); options.onBlur?.(); },
    toControlValueAccessor: () => ({
      writeValue: (val: UploadedImageData | null) => {
        revokeBlobUrl(previewUrl());
        value.set(val ?? null);
        previewUrl.set(val?.url ?? null);
        altText.set(val?.altText ?? '');
        blurColor.set(val?.blurColor ?? DEFAULT_BLUR_COLOR);
        error.set('');
        syncState();
      },
      registerOnChange: (fn) => { cvaOnChange = fn; },
      registerOnTouched: (fn) => { cvaOnTouched = fn; },
      setDisabledState: (isDisabled: boolean) => { disabled.set(isDisabled); syncState(); },
    }),
    destroy: () => {
      destroyed = true;
      tracker.abortAll();
      revokeBlobUrl(previewUrl());
    },
  };
}
