import { useEffect, useRef, useState } from 'react';
import type { QualityLevel, StandardPresetName, UploadedImageData, UploadPresetName } from '../../types';
import { QUALITY_PRESETS, STANDARD_PRESETS } from '../../types';
import { validateMultipleFiles } from '../../utils/validators';
import { useImageUploadContext } from '../context';
import {
  formatNeedsAltMessage,
  formatSkippedImagesMessage,
  normalizeUploadLocale,
  resolveTranslations,
} from '../i18n';
import type { ImagePreview, MultiImageUploadProps } from '../types';
import {
  collectUploadedData,
  formatMinImagesMessage,
  mapUploadedToPreview,
  resolveInitialQuality,
  runParallelUploadPool,
  serializeMultiFormValue,
  syncPreviewsWithValue,
} from './uploadQueue';
import { useFilePreview } from './useFilePreview';
import { useImageUpload } from './useImageUpload';

const EMPTY_IMAGES: UploadedImageData[] = [];

export interface MultiUploadStats { total: number; completed: number; failed: number; }

export type UseMultiImageStateOptions<TPreset extends string = UploadPresetName> =
  Omit<MultiImageUploadProps<TPreset>, 'mode'> & { mode?: 'multiple' };

let tempIdCounter = 0;

export function useMultiImageState<TPreset extends string = UploadPresetName>(
  options: UseMultiImageStateOptions<TPreset>,
) {
  const { onChange, preset, isOpen, onClose, minImages, required, formValue } = options;
  const value = options.value ?? EMPTY_IMAGES;
  const maxImages = options.maxImages ?? 999;
  const maxParallelUploads = options.maxParallelUploads ?? 2;

  const ctx = useImageUploadContext();
  const locale = normalizeUploadLocale(options.locale || ctx.locale);
  const ui = resolveTranslations(locale, options.translations || ctx.translations);
  const requireAltText = options.requireAltText ?? ctx.requireAltText;
  const standardPreset = preset ? STANDARD_PRESETS[preset as StandardPresetName] : undefined;
  const maxSizeMB = options.maxSizeMB ?? standardPreset?.maxSizeMB ?? 10;
  const requiresManualCommit = Boolean(isOpen);

  const [previews, setPreviews] = useState<ImagePreview[]>(() => value.map((img) => mapUploadedToPreview(img)));
  const previewsRef = useRef<ImagePreview[]>(previews);
  previewsRef.current = previews;
  const uncommittedIdsRef = useRef<Set<string>>(new Set());
  const isRetryingRef = useRef(false);

  const [validationError, setValidationError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [selectedPreviews, setSelectedPreviews] = useState<Set<string>>(() => new Set());
  const [uploadStats, setUploadStats] = useState<MultiUploadStats>({ total: 0, completed: 0, failed: 0 });
  const [editingAltTextId, setEditingAltTextId] = useState<string | null>(null);
  const [showMissingAltWarning, setShowMissingAltWarning] = useState(false);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(() =>
    resolveInitialQuality(options.quality ?? standardPreset?.quality, standardPreset?.recommendedQualityLevel),
  );

  const { createPreview, revokePreview } = useFilePreview({ errorLabel: ui.failedCreatePreview });
  const infoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current); }, []);

  useEffect(() => {
    setPreviews((current) => {
      const resolved = syncPreviewsWithValue(current, value, requiresManualCommit, uncommittedIdsRef.current);
      previewsRef.current = resolved;
      return resolved;
    });
  }, [value, requiresManualCommit]);

  const emitImmediateChange = (nextPreviews: ImagePreview[]) => {
    if (!requiresManualCommit) onChange(collectUploadedData(nextPreviews, true));
  };

  const patchByIdOrFile = (uploadId: string | undefined, file: File | undefined, patch: Partial<ImagePreview>, emit = false) => {
    const next = previewsRef.current.map((p) => {
      if (!(uploadId ? p.id === uploadId : p.file === file)) return p;
      if (patch.url && p.url && p.url !== patch.url) revokePreview(p.url);
      return { ...p, ...patch };
    });
    previewsRef.current = next;
    setPreviews(next);
    if (emit) emitImmediateChange(next);
  };

  const patchPreview = (id: string, patch: (p: ImagePreview) => ImagePreview) => {
    const next = previewsRef.current.map((p) => (p.id === id ? patch(p) : p));
    previewsRef.current = next;
    setPreviews(next);
    emitImmediateChange(next);
  };

  const { uploadImage, abortUpload, abortAll } = useImageUpload({
    preset, folder: options.folder, bucket: options.bucket, metadata: options.metadata,
    outputFormat: options.outputFormat, quality: QUALITY_PRESETS[qualityLevel].value,
    maxDimensions: options.maxDimensions, customFilename: options.customFilename,
    endpoint: options.endpoint, uploader: options.uploader,
    headers: options.headers, withCredentials: options.withCredentials, locale,
    onSuccess: (data, file, uploadId) => {
      if (uploadId && requiresManualCommit) uncommittedIdsRef.current.add(uploadId);
      patchByIdOrFile(uploadId, file, {
        url: data.url, uploadMessage: undefined, originalSize: data.originalSize,
        optimizedSize: data.size, data, blurColor: data.blurColor,
        error: undefined, isUploading: false, progress: 100,
      }, true);
      setUploadStats((s) => ({ ...s, completed: s.completed + 1 }));
    },
    onError: (error, file, uploadId) => {
      patchByIdOrFile(uploadId, file, { uploadMessage: undefined, error, isUploading: false, progress: 0 });
      setUploadStats((s) => ({ ...s, failed: s.failed + 1 }));
    },
    onProgress: (progress, uploadMessage, file, uploadId) => {
      patchByIdOrFile(uploadId, file, { uploadMessage, progress, isUploading: true });
    },
  });

  useEffect(() => {
    if (isOpen === false) { abortAll(); uncommittedIdsRef.current.clear(); }
  }, [isOpen, abortAll]);

  const runBatchUploads = async (items: ImagePreview[], files: File[]) => {
    options.onUploadStart?.(files);
    const completedBatch: UploadedImageData[] = [];
    await runParallelUploadPool(items, maxParallelUploads, async (item) => {
      if (!previewsRef.current.some((p) => p.id === item.id) || !item.file) return;
      const uploaded = await uploadImage(item.file, item.altText, undefined, { uploadId: item.id });
      if (uploaded) completedBatch.push(uploaded);
    });
    if (completedBatch.length > 0) options.onUploadComplete?.(completedBatch);
  };

  const handleFileSelect = async (files: FileList) => {
    setValidationError('');
    setInfoMessage('');
    const allFiles = Array.from(files);
    const imageFiles = allFiles.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) { setValidationError(ui.noValidImageFiles); return; }
    if (allFiles.length > imageFiles.length) {
      setInfoMessage(formatSkippedImagesMessage(ui, imageFiles.length, allFiles.length - imageFiles.length, locale));
      if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);
      infoTimeoutRef.current = setTimeout(() => setInfoMessage(''), 5000);
    }

    const activeCount = previewsRef.current.filter((p) => !p.error).length;
    const validationResult = validateMultipleFiles(imageFiles, maxSizeMB, activeCount, maxImages, locale);
    if (validationResult) { setValidationError(validationResult); return; }

    setUploadStats({ total: imageFiles.length, completed: 0, failed: 0 });
    const newPreviews: ImagePreview[] = [];
    for (const file of imageFiles) {
      try {
        const url = await createPreview(file);
        tempIdCounter += 1;
        newPreviews.push({
          id: `temp-${Date.now()}-${tempIdCounter}`, url, file, fileName: file.name,
          uploadMessage: ui.queued, originalSize: file.size, optimizedSize: null,
          isUploading: true, progress: 0,
        });
      } catch {
        setValidationError(ui.failedCreatePreviewFor.replace('{file}', file.name));
        return;
      }
    }
    const nextBatch = [...previewsRef.current, ...newPreviews];
    previewsRef.current = nextBatch;
    setPreviews(nextBatch);
    await runBatchUploads(newPreviews, imageFiles);
  };

  const removeIds = (ids: Set<string>) => {
    for (const p of previewsRef.current) {
      if (ids.has(p.id)) {
        abortUpload(p.id);
        if (p.file) abortUpload(p.file);
        revokePreview(p.url);
        uncommittedIdsRef.current.delete(p.id);
      }
    }
    const next = previewsRef.current.filter((p) => !ids.has(p.id));
    previewsRef.current = next;
    setPreviews(next);
    emitImmediateChange(next);
  };

  const handleRemove = (id: string) => {
    removeIds(new Set([id]));
    setSelectedPreviews((prev) => {
      if (!prev.has(id)) return prev;
      const copy = new Set(prev);
      copy.delete(id);
      return copy;
    });
  };

  const handleCancelUpload = (id: string) => {
    if (!previewsRef.current.some((p) => p.id === id)) return;
    handleRemove(id);
    options.onUploadCancel?.(id);
  };

  const handleRemoveSelected = () => { removeIds(new Set(selectedPreviews)); setSelectedPreviews(new Set()); };
  const handleClearAll = () => { removeIds(new Set(previewsRef.current.map((p) => p.id))); setSelectedPreviews(new Set()); setValidationError(''); };

  const toggleSelect = (id: string) => {
    setSelectedPreviews((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id); else copy.add(id);
      return copy;
    });
  };

  const handleRetryUpload = async (id: string) => {
    const target = previewsRef.current.find((p) => p.id === id && p.error && p.file);
    if (!target || !target.file) return;
    setUploadStats({ total: 1, completed: 0, failed: 0 });
    const updated = previewsRef.current.map((p) =>
      p.id === id ? { ...p, error: undefined, isUploading: true, progress: 0, uploadMessage: ui.retrying } : p,
    );
    previewsRef.current = updated;
    setPreviews(updated);
    await runBatchUploads([target], [target.file]);
  };

  const handleRetryFailed = async () => {
    if (isRetryingRef.current) return;
    const failedItems = previewsRef.current.filter((p) => p.error && p.file);
    if (failedItems.length === 0) return;
    isRetryingRef.current = true;
    try {
      setUploadStats({ total: failedItems.length, completed: 0, failed: 0 });
      const failedIds = new Set(failedItems.map((p) => p.id));
      const updated = previewsRef.current.map((p) =>
        failedIds.has(p.id) ? { ...p, error: undefined, isUploading: true, progress: 0, uploadMessage: ui.retrying } : p,
      );
      previewsRef.current = updated;
      setPreviews(updated);
      await runBatchUploads(failedItems, failedItems.map((p) => p.file!).filter(Boolean));
    } finally {
      isRetryingRef.current = false;
    }
  };

  const handleAltTextSave = (previewId: string, altText: string) => {
    patchPreview(previewId, (p) => ({ ...p, altText, data: p.data ? { ...p.data, altText } : p.data }));
    setEditingAltTextId(null);
    setShowMissingAltWarning(false);
  };

  const handleColorChange = (previewId: string, blurColor: string) => {
    patchPreview(previewId, (p) => ({ ...p, blurColor, data: p.data ? { ...p.data, blurColor } : p.data }));
  };

  const isUploading = previews.some((p) => p.isUploading);
  const hasFailedUploads = previews.some((p) => Boolean(p.error));
  const uploadingPreviews = previews.filter((p) => p.isUploading);
  const completedPreviews = previews.filter((p) => Boolean(p.data) && !p.isUploading);
  const imagesWithoutAlt = completedPreviews.filter((p) => !p.altText || !p.altText.trim());
  const editingTarget = editingAltTextId ? (previews.find((p) => p.id === editingAltTextId) ?? null) : null;
  const minImagesWarning = !isUploading && minImages && previews.length > 0 && completedPreviews.length < minImages
    ? formatMinImagesMessage(ui.minImagesError, minImages) : '';
  const serializedFormValue = serializeMultiFormValue(previews, formValue ?? 'json');

  const handleSaveImages = () => {
    if (required && completedPreviews.length === 0) { setValidationError(ui.requiredFieldError); return; }
    if (minImages && completedPreviews.length < minImages) {
      setValidationError(formatMinImagesMessage(ui.minImagesError, minImages));
      return;
    }
    if (requireAltText && imagesWithoutAlt.length > 0) {
      setShowMissingAltWarning(true);
      setValidationError(formatNeedsAltMessage(ui, imagesWithoutAlt.length, locale));
      return;
    }
    setShowMissingAltWarning(false);
    setValidationError('');
    uncommittedIdsRef.current.clear();
    onChange(collectUploadedData(previews, false));
    onClose?.();
  };

  return {
    locale, ui, requireAltText, maxSizeMB, previews,
    validationError: validationError || minImagesWarning, infoMessage,
    selectedPreviews, setSelectedPreviews, uploadStats,
    editingAltTextId, setEditingAltTextId, showMissingAltWarning,
    qualityLevel, setQualityLevel, isUploading, hasFailedUploads, uploadingPreviews,
    completedPreviews, imagesWithoutAlt, editingTarget, serializedFormValue,
    handleFileSelect, handleRemove, handleCancelUpload, handleRemoveSelected, handleClearAll,
    toggleSelect, handleRetryUpload, handleRetryFailed, handleAltTextSave,
    handleColorChange, handleSaveImages,
  };
}
