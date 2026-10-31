import { useEffect, useRef, useState } from 'react';
import type { QualityLevel, StandardPresetName, UploadedImageData, UploadPresetName } from '../../types';
import { QUALITY_PRESETS, STANDARD_PRESETS } from '../../types';
import { validateMultipleFiles } from '../../utils/validators';
import { useImageUploadContext } from '../context';
import { normalizeUploadLocale, resolveTranslations } from '../i18n';
import type { ImagePreview, MultiImageUploadProps } from '../types';
import { useFilePreview } from './useFilePreview';
import { useImageUpload } from './useImageUpload';

const EMPTY_IMAGES: UploadedImageData[] = [];

export interface MultiUploadStats { total: number; completed: number; failed: number; }

export type UseMultiImageStateOptions<TPreset extends string = UploadPresetName> =
  Omit<MultiImageUploadProps<TPreset>, 'mode'> & { mode?: 'multiple' };

function mapUploadedToPreview(img: UploadedImageData, prev?: ImagePreview): ImagePreview {
  const altText = prev?.altText && !img.altText?.trim() ? prev.altText : img.altText;
  return {
    id: img.url, url: img.url, file: null, uploadMessage: null,
    originalSize: img.originalSize, optimizedSize: img.size,
    data: { ...img, altText }, altText, blurColor: img.blurColor || prev?.blurColor,
  };
}

function resolveInitialQuality(q?: number, fallback: QualityLevel = 'high'): QualityLevel {
  if (!q) return fallback;
  return q <= 55 ? 'low' : q <= 78 ? 'medium' : q <= 90 ? 'high' : 'maximum';
}

function collectUploadedData(list: ImagePreview[], readyOnly: boolean): UploadedImageData[] {
  return list
    .filter((p) => p.data && (!readyOnly || !p.isUploading))
    .map((p) => ({ ...p.data!, altText: p.altText ?? p.data!.altText, blurColor: p.blurColor ?? p.data!.blurColor }));
}

export function useMultiImageState<TPreset extends string = UploadPresetName>(
  options: UseMultiImageStateOptions<TPreset>,
) {
  const { onChange, preset, isOpen, onClose } = options;
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
  const [validationError, setValidationError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [selectedPreviews, setSelectedPreviews] = useState<Set<string>>(() => new Set());
  const [uploadStats, setUploadStats] = useState<MultiUploadStats>({ total: 0, completed: 0, failed: 0 });
  const [editingAltTextId, setEditingAltTextId] = useState<string | null>(null);
  const [showMissingAltWarning, setShowMissingAltWarning] = useState(false);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(() =>
    resolveInitialQuality(options.quality ?? standardPreset?.quality, standardPreset?.recommendedQualityLevel),
  );

  const { createPreview } = useFilePreview();

  const infoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    setPreviews((current) => {
      const prevMap = new Map<string, ImagePreview>();
      current.forEach((p) => {
        prevMap.set(p.id, p);
        if (p.url) prevMap.set(p.url, p);
      });
      const synced = value.map((img) => mapUploadedToPreview(img, prevMap.get(img.url)));
      const pending = current.filter(
        (p) =>
          !value.some((img) => img.url === p.id || (p.url && img.url === p.url)) &&
          (p.isUploading || Boolean(p.error)),
      );
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
            p.isUploading === it.isUploading
          );
        });
      const resolved = isSame ? current : next;
      previewsRef.current = resolved;
      return resolved;
    });
  }, [value]);

  const emitImmediateChange = (nextPreviews: ImagePreview[]) => {
    if (!requiresManualCommit) onChange(collectUploadedData(nextPreviews, true));
  };

  const patchByFile = (file: File | undefined, patch: Partial<ImagePreview>, emit = false) => {
    const next = previewsRef.current.map((p) => (p.file === file ? { ...p, ...patch } : p));
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

  const { uploadImage } = useImageUpload({
    preset, folder: options.folder, bucket: options.bucket, metadata: options.metadata,
    outputFormat: options.outputFormat, quality: QUALITY_PRESETS[qualityLevel].value,
    maxDimensions: options.maxDimensions, customFilename: options.customFilename,
    endpoint: options.endpoint, uploader: options.uploader,
    headers: options.headers, withCredentials: options.withCredentials, locale,
    onSuccess: (data, file) => {
      patchByFile(file, {
        url: data.url, uploadMessage: undefined, originalSize: data.originalSize,
        optimizedSize: data.size, data, blurColor: data.blurColor,
        error: undefined, isUploading: false, progress: 100,
      }, true);
      setUploadStats((s) => ({ ...s, completed: s.completed + 1 }));
    },
    onError: (error, file) => {
      patchByFile(file, { uploadMessage: undefined, error, isUploading: false, progress: 0 });
      setUploadStats((s) => ({ ...s, failed: s.failed + 1 }));
    },
    onProgress: (progress, uploadMessage, file) => {
      patchByFile(file, { uploadMessage, progress, isUploading: true });
    },
  });

  const handleFileSelect = async (files: FileList) => {
    setValidationError('');
    setInfoMessage('');
    const allFiles = Array.from(files);
    const imageFiles = allFiles.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setValidationError(ui.noValidImageFiles);
      return;
    }
    if (allFiles.length > imageFiles.length) {
      const skipped = allFiles.length - imageFiles.length;
      const msg = ui.selectedImagesSkipped
        .replace('{imageCount}', String(imageFiles.length))
        .replace('{imageSuffix}', imageFiles.length > 1 ? 's' : '')
        .replace('{skippedCount}', String(skipped))
        .replace('{skippedSuffix}', skipped > 1 ? 's' : '');
      setInfoMessage(msg);
      if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);
      infoTimeoutRef.current = setTimeout(() => setInfoMessage(''), 5000);
    }
    const validationResult = validateMultipleFiles(imageFiles, maxSizeMB, previews.length, maxImages, locale);
    if (validationResult) {
      setValidationError(validationResult);
      return;
    }

    setUploadStats({ total: imageFiles.length, completed: 0, failed: 0 });
    const newPreviews: ImagePreview[] = [];
    for (const file of imageFiles) {
      try {
        const url = await createPreview(file);
        newPreviews.push({
          id: `temp-${Date.now()}-${Math.random()}`, url, file, fileName: file.name,
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

    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(maxParallelUploads, imageFiles.length));
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < imageFiles.length) {
          const file = imageFiles[nextIndex];
          nextIndex += 1;
          await uploadImage(file);
        }
      }),
    );
  };

  const removeIds = (ids: Set<string>) => {
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

  const handleRemoveSelected = () => {
    removeIds(new Set(selectedPreviews));
    setSelectedPreviews(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedPreviews((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  const handleRetryFailed = async () => {
    for (const item of previews.filter((p) => p.error && p.file)) {
      if (item.file) {
        patchByFile(item.file, { error: undefined, isUploading: true, uploadMessage: ui.retrying });
        await uploadImage(item.file);
      }
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

  const handleSaveImages = () => {
    if (requireAltText && imagesWithoutAlt.length > 0) {
      const count = imagesWithoutAlt.length;
      setShowMissingAltWarning(true);
      setValidationError(
        ui.needsAltBeforeSave.replace('{count}', String(count)).replace('{suffix}', count > 1 ? 's' : '').replace('{verbSuffix}', count > 1 ? '' : 's'),
      );
      return;
    }
    setShowMissingAltWarning(false);
    setValidationError('');
    onChange(collectUploadedData(previews, false));
    onClose?.();
  };

  return {
    locale, ui, requireAltText, maxSizeMB,
    previews, validationError, infoMessage,
    selectedPreviews, setSelectedPreviews, uploadStats,
    editingAltTextId, setEditingAltTextId, showMissingAltWarning,
    qualityLevel, setQualityLevel,
    isUploading, hasFailedUploads, uploadingPreviews,
    completedPreviews, imagesWithoutAlt, editingTarget,
    handleFileSelect, handleRemove, handleRemoveSelected,
    toggleSelect, handleRetryFailed, handleAltTextSave,
    handleColorChange, handleSaveImages,
  };
}
