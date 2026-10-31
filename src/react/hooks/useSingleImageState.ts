import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QualityLevel, StandardPresetName, UploadedImageData, UploadPresetConfig, UploadPresetName } from '../../types';
import { QUALITY_PRESETS, STANDARD_PRESETS } from '../../types';
import { DEFAULT_BLUR_COLOR, normalizeColorInput } from '../../utils/color';
import { validateImageFile } from '../../utils/validators';
import { useImageUploadContext } from '../context';
import { normalizeUploadLocale, resolveTranslations } from '../i18n';
import type { SingleImageUploadProps } from '../types';
import { createUploadSessionCache, downloadImageWithFallback } from '../utils/sessionMetaCache';
import { useFilePreview } from './useFilePreview';
import { useImageUpload } from './useImageUpload';

function resolveInitialQualityLevel(quality?: number, preset?: UploadPresetConfig): QualityLevel {
  const q = quality ?? preset?.quality;
  if (!q) return preset?.recommendedQualityLevel || 'high';
  if (q <= 55) return 'low';
  if (q <= 78) return 'medium';
  return q <= 90 ? 'high' : 'maximum';
}

export function useSingleImageState<TPreset extends string = UploadPresetName>(
  props: SingleImageUploadProps<TPreset>,
) {
  const {
    value, onChange, preset, folder, bucket, metadata, endpoint, uploader,
    headers, withCredentials, locale: propLocale, translations,
    initialAltText: propInitialAltText, maxSizeMB: propMaxSizeMB,
    maxDimensions, requireAltText: propRequireAltText, isOpen, onClose,
    outputFormat, quality: initialQualityProp, customFilename,
  } = props;

  const ctx = useImageUploadContext();
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(locale, translations || ctx.translations);
  const requireAltText = propRequireAltText ?? ctx.requireAltText;
  const standardPreset = preset ? STANDARD_PRESETS[preset as StandardPresetName] : undefined;
  const maxSizeMB = propMaxSizeMB ?? standardPreset?.maxSizeMB ?? 10;
  const requiresManualCommit = Boolean(isOpen);
  const cache = useMemo(() => createUploadSessionCache(ctx.storageKeyPrefix || 'iuk'), [ctx.storageKeyPrefix]);

  const objVal = typeof value === 'object' && value ? value : null;
  const initPreview = typeof value === 'string' ? value : objVal?.url || null;
  const initAlt = objVal?.altText || propInitialAltText || '';
  const initColor = objVal?.blurColor || DEFAULT_BLUR_COLOR;

  const [preview, setPreview] = useState<string | null>(initPreview);
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

  const resetColorAndErrorState = () => {
    setValidationError('');
    setHasColorOverride(false);
    setBlurColor(DEFAULT_BLUR_COLOR);
    setDetectedBlurColor(DEFAULT_BLUR_COLOR);
    setIsBlurModalOpen(false);
  };

  const { createPreview } = useFilePreview();
  const { uploadImage, isUploading, progress, uploadMessage, reset } = useImageUpload({
    preset, folder, bucket, metadata, outputFormat, maxDimensions, customFilename,
    quality: QUALITY_PRESETS[qualityLevel].value,
    endpoint, uploader, headers, withCredentials, locale,
    onSuccess: (data) => {
      const nextPreviewUrl = /^(?:blob:|data:)/i.test(data.url)
        ? data.url
        : `${data.url}${data.url.includes('?') ? '&' : '?'}t=${Date.now()}`;
      setPreview(nextPreviewUrl);
      setSizeInfo({ original: data.originalSize || 0, optimized: data.size });
      const normColor = data.blurColor || DEFAULT_BLUR_COLOR;
      setBlurColor(normColor);
      setDetectedBlurColor(normColor);
      setHasColorOverride(false);
      setBlurDataUrlState(data.blurDataUrl || '');
      const keyInfo = { url: data.url, contentHash: data.contentHash };
      cache.writeBlurMetaFor(keyInfo, { blurDataUrl: data.blurDataUrl || '', blurColor: normColor });
      const payload: UploadedImageData = { ...data, altText, blurColor: normColor };
      setUploadedData(payload);
      lastAltRef.current = altText;
      cache.writeAltMetaFor(keyInfo, altText);
      if (!requiresManualCommit) onChange(payload);
    },
    onError: (errorMsg) => {
      setValidationError(errorMsg);
      setPreview(null);
      setUploadedData(null);
    },
  });

  useEffect(() => {
    const incomingObj = typeof value === 'object' && value ? value : null;
    const nextPreview = typeof value === 'string' ? value : incomingObj?.url || null;
    const rawAlt = incomingObj?.altText || propInitialAltText || '';
    const cachedAlt = cache.readAltMetaFor({ url: incomingObj ? incomingObj.url : nextPreview, contentHash: incomingObj?.contentHash ?? null });
    const nextAlt =
      rawAlt.trim() === '' && nextPreview === preview && (lastAltRef.current.trim() !== '' || cachedAlt?.trim())
        ? lastAltRef.current.trim() || cachedAlt || rawAlt
        : rawAlt;
    const nextColor = incomingObj?.blurColor || DEFAULT_BLUR_COLOR;

    const stripCacheQuery = (u: string | null) =>
      u && !/^(?:blob:|data:)/i.test(u) ? u.split('?')[0] : u;
    if (stripCacheQuery(nextPreview) !== stripCacheQuery(preview)) setPreview(nextPreview);
    if (nextAlt !== altText && (nextPreview !== preview || nextAlt.trim() !== '' || !altText.trim())) setAltText(nextAlt);

    const nextIsFallback = nextColor === DEFAULT_BLUR_COLOR;
    if (nextColor !== blurColor && (nextPreview !== preview || (!hasColorOverride && (!nextIsFallback || blurColor === DEFAULT_BLUR_COLOR)))) {
      setBlurColor(nextColor);
      setDetectedBlurColor(nextColor);
      setHasColorOverride(false);
    }
    const nextBlurUrl = incomingObj?.blurDataUrl || '';
    if (nextPreview !== preview || (nextBlurUrl && nextBlurUrl !== blurDataUrlState)) {
      setBlurDataUrlState(nextBlurUrl);
    }

    if (nextPreview) {
      const cached = cache.readBlurMetaFor({
        url: nextPreview,
        contentHash: incomingObj?.contentHash || uploadedData?.contentHash,
      });
      if (cached?.blurDataUrl && !nextBlurUrl) setBlurDataUrlState(cached.blurDataUrl);
      if (cached?.blurColor && nextIsFallback && blurColor === DEFAULT_BLUR_COLOR) {
        setBlurColor(cached.blurColor);
        setDetectedBlurColor(cached.blurColor);
      }
    }

    if (!value) {
      setUploadedData(null);
      setBlurDataUrlState('');
      setSizeInfo(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } else if (incomingObj?.url) {
      setUploadedData((prev) => (prev?.url === incomingObj.url ? prev : incomingObj));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, propInitialAltText]);

  const buildExistingImagePayload = (overrides: Partial<UploadedImageData> = {}): UploadedImageData | null => {
    const base: UploadedImageData | null = uploadedData
      ? { ...uploadedData }
      : objVal
        ? { ...objVal }
        : typeof value === 'string' && value.trim()
          ? { url: value, blurDataUrl: '', blurColor: DEFAULT_BLUR_COLOR, altText: '', width: 0, height: 0, format: 'webp', size: 0, contentHash: 'existing-image', uploadedAt: new Date().toISOString() }
          : null;
    if (!base) return null;
    return {
      ...base,
      ...overrides,
      url: (overrides.url ?? base.url) || preview || '',
      altText: overrides.altText ?? altText ?? base.altText ?? '',
      blurColor: overrides.blurColor ?? blurColor ?? base.blurColor ?? DEFAULT_BLUR_COLOR,
      blurDataUrl: overrides.blurDataUrl ?? base.blurDataUrl ?? blurDataUrlState ?? '',
    };
  };

  const commitIfAuto = (overrides: Partial<UploadedImageData>) => {
    if (!requiresManualCommit) {
      const payload = buildExistingImagePayload(overrides);
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
    setSelectedFile(file);
    resetColorAndErrorState();
    const err = validateImageFile(file, maxSizeMB, locale);
    if (err) {
      setValidationError(err);
      return;
    }
    try {
      setPreview(await createPreview(file));
      setAltText('');
      lastAltRef.current = '';
    } catch {
      setValidationError(ui.failedCreatePreview);
      return;
    }
    await uploadImage(file, altText);
  };

  const handleRemoveTile = () => {
    setPreview(null);
    setAltText('');
    setBlurDataUrlState('');
    setSizeInfo(null);
    setUploadedData(null);
    setSelectedFile(null);
    resetColorAndErrorState();
    reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
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
    if (requireAltText && preview && !altText?.trim()) {
      setShowMissingAltWarning(true);
      setValidationError(ui.addAltBeforeSaving);
      return;
    }
    setShowMissingAltWarning(false);
    setValidationError('');
    const payload = buildExistingImagePayload();
    if (payload) {
      lastAltRef.current = payload.altText || lastAltRef.current;
      cache.writeAltMetaFor({ url: payload.url, contentHash: payload.contentHash }, payload.altText || '');
      onChange(payload);
    }
    onClose?.();
  };

  const downloadUrl = uploadedData?.url ?? (typeof value === 'string' ? value : objVal?.url) ?? null;
  const handleDownload = useCallback(async () => {
    if (downloadUrl) await downloadImageWithFallback(downloadUrl, uploadedData?.format);
  }, [downloadUrl, uploadedData?.format]);

  return {
    locale, ui, requireAltText, maxSizeMB, fileInputRef,
    preview, altText, blurColor, detectedBlurColor, blurDataUrlState,
    validationError, showMissingAltWarning, editingAltText, setEditingAltText,
    sizeInfo, uploadedData, isBlurModalOpen, setIsBlurModalOpen,
    selectedFile, qualityLevel, setQualityLevel, isUploading, progress, uploadMessage,
    currentImageData: uploadedData ?? objVal, canDownload: Boolean(downloadUrl),
    applyBlurColor, handleResetColor, handleFileSelect, handleRemoveTile,
    handleAltTextSave, handleSaveImage, handleDownload,
  };
}
