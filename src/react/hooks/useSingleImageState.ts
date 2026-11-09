import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isHeicAsset } from '../../client/asset';
import type { QualityLevel, StandardPresetName, UploadedImageData, UploadPresetName } from '../../types';
import { QUALITY_PRESETS, STANDARD_PRESETS } from '../../types';
import { DEFAULT_BLUR_COLOR, normalizeColorInput } from '../../utils/color';
import { validateImageFile } from '../../utils/validators';
import { useImageUploadContext } from '../context';
import { normalizeUploadLocale, resolveTranslations } from '../i18n';
import type { SingleImageUploadProps } from '../types';
import { createUploadSessionCache, downloadImageWithFallback } from '../utils/sessionMetaCache';
import {
  buildSingleImagePayload,
  resolveInitialQualityLevel,
  resolveLiveAnnouncement,
  serializeSingleFormValue,
  syncIncomingSingleValue,
  triggerOptionalDelete,
} from './singleStateHelpers';
import { useFilePreview } from './useFilePreview';
import { useImageUpload } from './useImageUpload';

export { resolveLiveAnnouncement, serializeSingleFormValue };

export function useSingleImageState<TPreset extends string = UploadPresetName>(
  props: SingleImageUploadProps<TPreset>,
) {
  const {
    value, onChange, preset, folder, bucket, metadata, endpoint, deleteEndpoint,
    uploader, customDeleter, uploadMode, headers, withCredentials,
    locale: propLocale, translations, initialAltText: propInitialAltText,
    maxSizeMB: propMaxSizeMB, maxDimensions, aspectRatio, crop, transformAsset,
    requireAltText: propRequireAltText, required, isOpen, onClose,
    outputFormat, quality: initialQualityProp, customFilename, formValue,
  } = props;

  const ctx = useImageUploadContext();
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(locale, translations || ctx.translations);
  const requireAltText = propRequireAltText ?? ctx.requireAltText;
  const standardPreset = preset ? STANDARD_PRESETS[preset as StandardPresetName] : undefined;
  const maxSizeMB = propMaxSizeMB ?? standardPreset?.maxSizeMB ?? 10;
  const allowedFormats = props.allowedFormats ?? standardPreset?.allowedFormats;
  const requiresManualCommit = Boolean(isOpen);
  const cache = useMemo(() => createUploadSessionCache(ctx.storageKeyPrefix || 'iuk'), [ctx.storageKeyPrefix]);

  const objVal = typeof value === 'object' && value ? value : null;
  const initPreview = typeof value === 'string' ? value : objVal?.url || null;
  const initAlt = objVal?.altText || propInitialAltText || '';
  const initColor = objVal?.blurColor || DEFAULT_BLUR_COLOR;

  const [preview, setPreview] = useState<string | null>(initPreview);
  const previewRef = useRef<string | null>(initPreview);
  previewRef.current = preview;

  const [altText, setAltText] = useState<string>(initAlt);
  const [blurColor, setBlurColor] = useState<string>(initColor);
  const [detectedBlurColor, setDetectedBlurColor] = useState<string>(initColor);
  const [blurDataUrlState, setBlurDataUrlState] = useState<string>(objVal?.blurDataUrl || '');
  const [hasColorOverride, setHasColorOverride] = useState(false);
  const [validationError, setValidationError] = useState<string>('');
  const [showMissingAltWarning, setShowMissingAltWarning] = useState(false);
  const [editingAltText, setEditingAltText] = useState(false);
  const [sizeInfo, setSizeInfo] = useState<{ original: number; optimized: number } | null>(null);
  const [uploadedData, setUploadedData] = useState<UploadedImageData | null>(objVal && 'url' in objVal ? objVal : null);
  const [isBlurModalOpen, setIsBlurModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>(() => resolveInitialQualityLevel(initialQualityProp, standardPreset));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAltRef = useRef<string>(initAlt);
  const activeUploadIdRef = useRef<string | null>(null);
  const uploadSeqRef = useRef(0);

  const resetColorAndErrorState = () => {
    setValidationError('');
    setHasColorOverride(false);
    setBlurColor(DEFAULT_BLUR_COLOR);
    setDetectedBlurColor(DEFAULT_BLUR_COLOR);
    setIsBlurModalOpen(false);
  };

  const { createPreview, revokePreview } = useFilePreview({ errorLabel: ui.failedCreatePreview });

  const { uploadImage, abortAll, isUploading, progress, uploadMessage, reset } = useImageUpload({
    preset, folder, bucket, metadata, outputFormat, maxDimensions, aspectRatio, crop,
    maxSizeMB, allowedFormats, transformAsset, customFilename, quality: QUALITY_PRESETS[qualityLevel].value,
    endpoint, uploader, uploadMode, headers, withCredentials, locale,
    onSuccess: (data, _file, uploadId) => {
      if (uploadId && activeUploadIdRef.current && uploadId !== activeUploadIdRef.current) return;
      if (previewRef.current && previewRef.current !== data.url) revokePreview(previewRef.current);
      setPreview(data.url);
      setSizeInfo({ original: data.originalSize || 0, optimized: data.size });
      const normColor = data.blurColor || DEFAULT_BLUR_COLOR;
      setBlurColor(normColor);
      setDetectedBlurColor(normColor);
      setHasColorOverride(false);
      setBlurDataUrlState(data.blurDataUrl || '');
      const keyInfo = { url: data.url, contentHash: data.contentHash };
      cache.writeBlurMetaFor(keyInfo, { blurDataUrl: data.blurDataUrl || '', blurColor: normColor });
      const currentAlt = lastAltRef.current || data.altText || '';
      setAltText(currentAlt);
      lastAltRef.current = currentAlt;
      const payload: UploadedImageData = { ...data, altText: currentAlt, blurColor: normColor };
      setUploadedData(payload);
      cache.writeAltMetaFor(keyInfo, currentAlt);
      if (!requiresManualCommit) onChange(payload);
    },
    onError: (errorMsg, _file, uploadId) => {
      if (uploadId && activeUploadIdRef.current && uploadId !== activeUploadIdRef.current) return;
      revokePreview(previewRef.current);
      setValidationError(errorMsg);
      setPreview(null);
      setUploadedData(null);
    },
  });

  useEffect(() => {
    if (isOpen === false) abortAll();
  }, [isOpen, abortAll]);

  useEffect(() => {
    syncIncomingSingleValue({
      value, propInitialAltText, preview, altText, blurColor, blurDataUrlState,
      hasColorOverride, uploadedData, lastAltRef, fileInputEl: fileInputRef.current, cache,
      setPreview, setAltText, setBlurColor, setDetectedBlurColor,
      setHasColorOverride, setBlurDataUrlState, setUploadedData, setSizeInfo, setSelectedFile,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, propInitialAltText]);

  const commitIfAuto = (overrides: Partial<UploadedImageData>) => {
    if (!requiresManualCommit) {
      const payload = buildSingleImagePayload(
        { uploadedData, objVal, value, preview, altText, blurColor, blurDataUrlState },
        overrides,
      );
      if (payload) onChange(payload);
    }
  };

  const applyBlurColor = (color: string, options: { markOverride?: boolean } = {}) => {
    const normalized = normalizeColorInput(color);
    if (!normalized) return;
    setBlurColor(normalized);
    setHasColorOverride(options.markOverride !== false);
    setUploadedData((prev) => (prev ? { ...prev, blurColor: normalized } : prev));
    if (preview) cache.writeBlurMetaFor({ url: preview, contentHash: uploadedData?.contentHash }, { blurDataUrl: blurDataUrlState, blurColor: normalized });
    commitIfAuto({ blurColor: normalized });
  };

  const handleResetColor = () => {
    if (detectedBlurColor) applyBlurColor(detectedBlurColor, { markOverride: false });
  };

  const handleFileSelect = async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    abortAll();
    setSelectedFile(file);
    resetColorAndErrorState();
    if (!transformAsset && isHeicAsset(file)) {
      setValidationError(ui.heicNotSupported);
      return;
    }
    if (!isHeicAsset(file)) {
      const err = validateImageFile(file, maxSizeMB, locale, allowedFormats, {
        skipSizeCheck: Boolean(transformAsset),
      });
      if (err) { setValidationError(err); return; }
    }
    uploadSeqRef.current += 1;
    const uploadId = `single-${uploadSeqRef.current}`;
    activeUploadIdRef.current = uploadId;
    try {
      const nextBlobUrl = await createPreview(file);
      if (activeUploadIdRef.current !== uploadId) { revokePreview(nextBlobUrl); return; }
      revokePreview(previewRef.current);
      setPreview(nextBlobUrl);
      setAltText('');
      lastAltRef.current = '';
    } catch {
      setValidationError(ui.failedCreatePreview);
      return;
    }
    await uploadImage(file, '', customFilename, { uploadId, index: 0 });
  };

  const handleCancelUpload = () => {
    activeUploadIdRef.current = null;
    abortAll();
    revokePreview(previewRef.current);
    setPreview(null);
    setSelectedFile(null);
    reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveTile = () => {
    triggerOptionalDelete({
      data: uploadedData ?? objVal ?? (typeof value === 'string' && value ? value : null),
      url: uploadedData?.url ?? objVal?.url ?? (typeof value === 'string' ? value : previewRef.current),
      customDeleter: customDeleter ?? ctx.customDeleter,
      deleteEndpoint: deleteEndpoint ?? ctx.deleteEndpoint,
      headers: headers ?? ctx.headers,
      withCredentials: withCredentials ?? ctx.withCredentials,
    });
    handleCancelUpload();
    setAltText('');
    lastAltRef.current = '';
    setBlurDataUrlState('');
    setSizeInfo(null);
    setUploadedData(null);
    resetColorAndErrorState();
    if (!requiresManualCommit) onChange(null);
  };

  const handleAltTextSave = (newAltText: string) => {
    setAltText(newAltText);
    lastAltRef.current = newAltText;
    if (preview) cache.writeAltMetaFor({ url: preview, contentHash: uploadedData?.contentHash }, newAltText);
    setShowMissingAltWarning(false);
    setEditingAltText(false);
    commitIfAuto({ altText: newAltText });
  };

  const handleSaveImage = () => {
    if (required && !preview) { setValidationError(ui.requiredFieldError); return; }
    if (requireAltText && preview && !altText?.trim()) {
      setShowMissingAltWarning(true);
      setValidationError(ui.addAltBeforeSaving);
      return;
    }
    setShowMissingAltWarning(false);
    setValidationError('');
    const payload = buildSingleImagePayload({ uploadedData, objVal, value, preview, altText, blurColor, blurDataUrlState });
    if (payload) {
      lastAltRef.current = payload.altText || lastAltRef.current;
      cache.writeAltMetaFor({ url: payload.url, contentHash: payload.contentHash }, payload.altText || '');
      onChange(payload);
    }
    onClose?.();
  };

  const currentImageData = preview ? (uploadedData ?? objVal) : null;
  const downloadUrl = preview
    ? (uploadedData?.url ?? (typeof value === 'string' ? value : objVal?.url) ?? null)
    : null;
  const handleDownload = useCallback(async () => {
    if (downloadUrl) await downloadImageWithFallback(downloadUrl, uploadedData?.format);
  }, [downloadUrl, uploadedData?.format]);

  const liveAnnouncement = resolveLiveAnnouncement(isUploading, progress, Boolean(sizeInfo && !isUploading), ui);
  const serializedFormValue = serializeSingleFormValue({
    formValue, currentImageData, preview, altText, blurColor, blurDataUrlState, isUploading,
  });

  return {
    locale, ui, requireAltText, maxSizeMB, fileInputRef,
    preview, altText, blurColor, detectedBlurColor, blurDataUrlState,
    validationError, showMissingAltWarning, editingAltText, setEditingAltText,
    sizeInfo, uploadedData, isBlurModalOpen, setIsBlurModalOpen,
    selectedFile, qualityLevel, setQualityLevel, isUploading, progress, uploadMessage, liveAnnouncement,
    currentImageData, canDownload: Boolean(downloadUrl), serializedFormValue,
    applyBlurColor, handleResetColor, handleFileSelect, handleCancelUpload, handleRemoveTile,
    handleAltTextSave, handleSaveImage, handleDownload,
  };
}
