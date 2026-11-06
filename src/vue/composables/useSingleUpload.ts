import {
  type ComputedRef, computed, getCurrentInstance, getCurrentScope, onScopeDispose, type Ref, ref,
} from 'vue';
import { createUploadTracker, isUploadAbortError } from '../../client';
import type { QualityLevel, UploadedImageData, UploadPresetName } from '../../types';
import { DEFAULT_BLUR_COLOR, normalizeColorInput } from '../../utils/color';
import { createSuccessMessage, getStatusMessage } from '../../utils/formatters';
import { useImageUploadConfig } from '../config';
import type { UploadVisualState, VueSingleUploadOptions, VueSingleUploadPhase } from '../types';
import {
  computeVisualState, createBlobPreview, executeDeleteRequest,
  executeUploadRequest, prepareAndValidateAsset, resolveControllerEnv, revokeBlobUrl,
} from './uploadHelpers';

export interface VueSingleUploadController {
  value: Ref<UploadedImageData | null>;
  previewUrl: Ref<string | null>;
  isUploading: Ref<boolean>;
  progress: Ref<number>;
  uploadStatus: Ref<string>;
  error: Ref<string>;
  quality: Ref<QualityLevel>;
  altText: Ref<string>;
  blurColor: Ref<string>;
  disabled: Ref<boolean>;
  state: ComputedRef<UploadVisualState>;
  phase: Ref<VueSingleUploadPhase>;
  missingAltText: ComputedRef<boolean>;
  canSave: ComputedRef<boolean>;
  selectFile: (file: File) => Promise<UploadedImageData | null>;
  cancel: () => void;
  retry: () => Promise<UploadedImageData | null>;
  clear: () => Promise<void>;
  setValue: (val: UploadedImageData | string | null) => void;
  setAltText: (alt: string) => void;
  setBlurColor: (color: string) => void;
  setQuality: (q: QualityLevel) => void;
  setDisabled: (isDisabled: boolean) => void;
  setDragging: (isDragging: boolean) => void;
  destroy: () => void;
}

export function useSingleUpload<TPreset extends string = UploadPresetName>(
  options: VueSingleUploadOptions<TPreset> = {},
): VueSingleUploadController {
  const baseConfig = getCurrentInstance() ? useImageUploadConfig() : undefined;
  const getEnv = () => resolveControllerEnv(options, baseConfig);
  const initialEnv = getEnv();
  const initialObj =
    typeof options.value === 'object' && options.value ? options.value : null;
  const initialPreview =
    typeof options.value === 'string'
      ? options.value
      : (initialObj?.url ?? null);

  const value = ref<UploadedImageData | null>(initialObj);
  const previewUrl = ref<string | null>(initialPreview);
  const isUploading = ref<boolean>(false);
  const progress = ref<number>(0);
  const uploadStatus = ref<string>('');
  const error = ref<string>(options.error ?? '');
  const quality = ref<QualityLevel>(initialEnv.initQualityLevel);
  const altText = ref<string>(
    initialObj?.altText ?? options.initialAltText ?? '',
  );
  const blurColor = ref<string>(
    initialObj?.blurColor ?? DEFAULT_BLUR_COLOR,
  );
  const disabled = ref<boolean>(Boolean(options.disabled));
  const isDragging = ref<boolean>(false);
  const phase = ref<VueSingleUploadPhase>(
    options.error
      ? 'error'
      : initialPreview
        ? 'ready'
        : 'idle',
  );

  const tracker = createUploadTracker<File>();
  let destroyed = false;
  let lastSelectedFile: File | null = null;

  const state = computed<UploadVisualState>(() =>
    computeVisualState({
      disabled: disabled.value, isDragging: isDragging.value,
      isUploading: isUploading.value, hasError: Boolean(error.value),
      hasContent: Boolean(previewUrl.value || value.value),
    }),
  );
  const missingAltText = computed<boolean>(() =>
    Boolean(getEnv().requireAltText && value.value && !altText.value.trim()),
  );
  const canSave = computed<boolean>(() =>
    Boolean(value.value && !isUploading.value && !error.value && !missingAltText.value),
  );

  const failWith = (msg: string): null => {
    isUploading.value = false; progress.value = 0; uploadStatus.value = '';
    error.value = msg; phase.value = 'error'; options.onError?.(msg);
    return null;
  };

  const selectFile = async (file: File): Promise<UploadedImageData | null> => {
    if (destroyed || disabled.value) return null;
    const env = getEnv();
    lastSelectedFile = file;
    tracker.abortAll();
    error.value = '';

    const entry = tracker.createEntry(file, env.ui.preparingUpload);
    isUploading.value = true;
    progress.value = 0;
    uploadStatus.value = env.ui.preparingUpload;
    phase.value = options.transformAsset ? 'transforming' : 'uploading';

    try {
      const prepared = await prepareAndValidateAsset({
        file, env, options, signal: entry.controller.signal, index: 0,
      });
      if (prepared.error || !prepared.file) {
        tracker.removeEntry(entry.id);
        return failWith(prepared.error ?? env.ui.uploadFailed);
      }
      const workingFile = prepared.file;
      phase.value = 'uploading';

      const blobUrl = createBlobPreview(workingFile);
      if (blobUrl) { revokeBlobUrl(previewUrl.value); previewUrl.value = blobUrl; }

      options.onUploadStart?.(workingFile);
      const uploaded = await executeUploadRequest({
        file: workingFile, env, options, qualityLevel: quality.value,
        altText: altText.value, signal: entry.controller.signal,
        onUploadProgress: (pct) => {
          if (destroyed || entry.controller.signal.aborted) return;
          const clamped = Math.max(progress.value, Math.min(94, pct));
          progress.value = clamped;
          uploadStatus.value = getStatusMessage(clamped, env.locale);
        },
      });

      tracker.removeEntry(entry.id);
      if (destroyed || entry.controller.signal.aborted) return null;

      const resolvedColor = uploaded.blurColor || blurColor.value || DEFAULT_BLUR_COLOR;
      const resolvedAlt = altText.value || uploaded.altText || '';
      const payload: UploadedImageData = { ...uploaded, altText: resolvedAlt, blurColor: resolvedColor };

      revokeBlobUrl(previewUrl.value);
      previewUrl.value = payload.url;
      altText.value = resolvedAlt;
      blurColor.value = resolvedColor;
      value.value = payload;
      isUploading.value = false;
      progress.value = 100;
      phase.value = 'ready';
      uploadStatus.value = createSuccessMessage(workingFile.size, payload.size, false, env.locale);
      options.onChange?.(payload);
      options.onUploadComplete?.(payload);
      return payload;
    } catch (err) {
      tracker.removeEntry(entry.id);
      if (destroyed || entry.controller.signal.aborted || isUploadAbortError(err)) {
        isUploading.value = false; progress.value = 0; uploadStatus.value = '';
        phase.value = value.value ? 'ready' : 'idle';
        return null;
      }
      const msg = err instanceof Error ? err.message : env.ui.uploadFailed;
      revokeBlobUrl(previewUrl.value);
      previewUrl.value = value.value?.url ?? null;
      return failWith(msg);
    }
  };

  const cancel = () => {
    tracker.abortAll();
    revokeBlobUrl(previewUrl.value);
    previewUrl.value = value.value?.url ?? null;
    isUploading.value = false; progress.value = 0; uploadStatus.value = '';
    phase.value = value.value ? 'ready' : 'idle';
  };

  const clear = async (): Promise<void> => {
    const env = getEnv();
    tracker.abortAll();
    const current = value.value ?? previewUrl.value;
    revokeBlobUrl(previewUrl.value);
    previewUrl.value = null; value.value = null; altText.value = '';
    blurColor.value = DEFAULT_BLUR_COLOR; error.value = '';
    isUploading.value = false; progress.value = 0; uploadStatus.value = ''; phase.value = 'idle';
    if (current && !(typeof current === 'string' && current.startsWith('blob:'))) {
      await executeDeleteRequest(current, env, options);
    }
    options.onChange?.(null);
  };

  const setValue = (val: UploadedImageData | string | null) => {
    revokeBlobUrl(previewUrl.value);
    const nextObj = typeof val === 'object' && val ? val : null;
    const nextPreview = typeof val === 'string' ? val : (nextObj?.url ?? null);
    value.value = nextObj; previewUrl.value = nextPreview;
    altText.value = nextObj?.altText ?? '';
    blurColor.value = nextObj?.blurColor ?? DEFAULT_BLUR_COLOR;
    error.value = ''; phase.value = nextPreview ? 'ready' : 'idle';
  };

  const destroy = () => {
    destroyed = true; tracker.abortAll(); revokeBlobUrl(previewUrl.value);
  };
  if (getCurrentScope()) onScopeDispose(destroy);

  return {
    value, previewUrl, isUploading, progress, uploadStatus, error, quality, altText, blurColor,
    disabled, state, phase, missingAltText, canSave, selectFile, cancel,
    retry: () => (lastSelectedFile ? selectFile(lastSelectedFile) : Promise.resolve(null)),
    clear, setValue,
    setAltText: (nextAlt: string) => {
      altText.value = nextAlt;
      if (value.value) { const updated = { ...value.value, altText: nextAlt }; value.value = updated; options.onChange?.(updated); }
    },
    setBlurColor: (nextColor: string) => {
      const normalized = normalizeColorInput(nextColor);
      if (!normalized) return;
      blurColor.value = normalized;
      if (value.value) { const updated = { ...value.value, blurColor: normalized }; value.value = updated; options.onChange?.(updated); }
    },
    setQuality: (q: QualityLevel) => { quality.value = q; },
    setDisabled: (isDisabled: boolean) => { disabled.value = isDisabled; },
    setDragging: (dragging: boolean) => { isDragging.value = dragging; },
    destroy,
  };
}
