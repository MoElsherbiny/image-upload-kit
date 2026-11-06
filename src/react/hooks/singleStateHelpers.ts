import { deleteUploadedImage } from '../../client';
import type {
  QualityLevel,
  UploadedImageData,
  UploadPresetConfig,
} from '../../types';
import { DEFAULT_BLUR_COLOR } from '../../utils/color';
import type { UploadSessionCache } from '../utils/sessionMetaCache';

export function resolveInitialQualityLevel(
  quality?: number,
  preset?: UploadPresetConfig,
): QualityLevel {
  const q = quality ?? preset?.quality;
  if (!q) return preset?.recommendedQualityLevel || 'high';
  if (q <= 55) return 'low';
  if (q <= 78) return 'medium';
  return q <= 90 ? 'high' : 'maximum';
}

export function resolveLiveAnnouncement(
  isUploading: boolean,
  progress: number,
  hasCompletedUpload: boolean,
  ui: {
    uploadStartedLive: string;
    uploadProgressLive: string;
    uploadCompleteLive: string;
  },
): string {
  if (isUploading) {
    if (progress >= 75) return ui.uploadProgressLive.replace('{progress}', '75');
    if (progress >= 50) return ui.uploadProgressLive.replace('{progress}', '50');
    if (progress >= 25) return ui.uploadProgressLive.replace('{progress}', '25');
    return ui.uploadStartedLive;
  }
  return hasCompletedUpload ? ui.uploadCompleteLive : '';
}

export function stripUrlCacheQuery(u: string | null): string | null {
  return u && !/^(?:blob:|data:)/i.test(u) ? u.split('?')[0] : u;
}

export function triggerOptionalDelete(params: {
  data?: UploadedImageData | string | null;
  url?: string | null;
  customDeleter?: (data: UploadedImageData | string) => Promise<void>;
  deleteEndpoint?: string;
  headers?: Record<string, string>;
  withCredentials?: boolean;
}): void {
  const { data, url, customDeleter, deleteEndpoint, headers, withCredentials } =
    params;
  const resolvedUrl =
    url || (typeof data === 'string' ? data : data?.url) || null;
  const nonBlobUrl =
    resolvedUrl && !resolvedUrl.startsWith('blob:') ? resolvedUrl : null;
  const payload = data ?? nonBlobUrl;
  if (!payload) return;
  if (customDeleter) {
    void Promise.resolve(customDeleter(payload)).catch(() => {});
  } else if (deleteEndpoint && nonBlobUrl) {
    void deleteUploadedImage(deleteEndpoint, nonBlobUrl, {
      headers,
      withCredentials,
    }).catch(() => {});
  }
}

export function buildSingleImagePayload(
  params: {
    uploadedData: UploadedImageData | null;
    objVal: UploadedImageData | null;
    value?: string | UploadedImageData | null;
    preview: string | null;
    altText: string;
    blurColor: string;
    blurDataUrlState: string;
  },
  overrides: Partial<UploadedImageData> = {},
): UploadedImageData | null {
  const {
    uploadedData,
    objVal,
    value,
    preview,
    altText,
    blurColor,
    blurDataUrlState,
  } = params;
  const base: UploadedImageData | null = uploadedData
    ? { ...uploadedData }
    : objVal
      ? { ...objVal }
      : typeof value === 'string' && value.trim()
        ? {
            url: value,
            blurDataUrl: '',
            blurColor: DEFAULT_BLUR_COLOR,
            altText: '',
            width: 0,
            height: 0,
            format: 'webp',
            size: 0,
            contentHash: 'existing-image',
            uploadedAt: new Date().toISOString(),
          }
        : null;
  if (!base) return null;
  return {
    ...base,
    ...overrides,
    url: (overrides.url ?? base.url) || preview || '',
    altText: overrides.altText ?? altText ?? base.altText ?? '',
    blurColor:
      overrides.blurColor ?? blurColor ?? base.blurColor ?? DEFAULT_BLUR_COLOR,
    blurDataUrl:
      overrides.blurDataUrl ?? base.blurDataUrl ?? blurDataUrlState ?? '',
  };
}

export function serializeSingleFormValue(params: {
  formValue?: 'url' | 'json';
  currentImageData: UploadedImageData | null;
  preview: string | null;
  altText: string;
  blurColor: string;
  blurDataUrlState: string;
  isUploading: boolean;
}): string {
  const {
    formValue = 'url',
    currentImageData,
    preview,
    altText,
    blurColor,
    blurDataUrlState,
    isUploading,
  } = params;
  if (!preview || (isUploading && !currentImageData)) return '';
  const nonBlobPreview =
    preview && !preview.startsWith('blob:') ? preview : null;
  const resolvedUrl = currentImageData?.url || nonBlobPreview || '';
  if (!resolvedUrl) return '';
  if (formValue === 'json') {
    const payload = currentImageData
      ? {
          ...currentImageData,
          altText: altText || currentImageData.altText || '',
          blurColor: blurColor || currentImageData.blurColor || DEFAULT_BLUR_COLOR,
        }
      : {
          url: resolvedUrl,
          altText,
          blurColor: blurColor || DEFAULT_BLUR_COLOR,
          blurDataUrl: blurDataUrlState,
        };
    return JSON.stringify(payload);
  }
  return resolvedUrl;
}

export function syncIncomingSingleValue(params: {
  value?: string | UploadedImageData | null;
  propInitialAltText?: string;
  preview: string | null;
  altText: string;
  blurColor: string;
  blurDataUrlState: string;
  hasColorOverride: boolean;
  uploadedData: UploadedImageData | null;
  lastAltRef: { current: string };
  fileInputEl: HTMLInputElement | null;
  cache: UploadSessionCache;
  setPreview: (v: string | null) => void;
  setAltText: (v: string) => void;
  setBlurColor: (v: string) => void;
  setDetectedBlurColor: (v: string) => void;
  setHasColorOverride: (v: boolean) => void;
  setBlurDataUrlState: (v: string) => void;
  setUploadedData: (
    v:
      | UploadedImageData
      | null
      | ((prev: UploadedImageData | null) => UploadedImageData | null),
  ) => void;
  setSizeInfo: (v: { original: number; optimized: number } | null) => void;
  setSelectedFile: (v: File | null) => void;
}): void {
  const {
    value, propInitialAltText, preview, altText, blurColor, blurDataUrlState,
    hasColorOverride, uploadedData, lastAltRef, fileInputEl, cache,
    setPreview, setAltText, setBlurColor, setDetectedBlurColor,
    setHasColorOverride, setBlurDataUrlState, setUploadedData, setSizeInfo, setSelectedFile,
  } = params;

  const incomingObj = typeof value === 'object' && value ? value : null;
  const nextPreview = typeof value === 'string' ? value : incomingObj?.url || null;
  const rawAlt = incomingObj?.altText || propInitialAltText || '';
  const cachedAlt = cache.readAltMetaFor({
    url: incomingObj ? incomingObj.url : nextPreview,
    contentHash: incomingObj?.contentHash ?? null,
  });
  const nextAlt =
    rawAlt.trim() === '' &&
    nextPreview === preview &&
    (lastAltRef.current.trim() !== '' || cachedAlt?.trim())
      ? lastAltRef.current.trim() || cachedAlt || rawAlt
      : rawAlt;
  const nextColor = incomingObj?.blurColor || DEFAULT_BLUR_COLOR;

  if (stripUrlCacheQuery(nextPreview) !== stripUrlCacheQuery(preview)) {
    setPreview(nextPreview);
  }
  if (
    nextAlt !== altText &&
    (nextPreview !== preview || nextAlt.trim() !== '' || !altText.trim())
  ) {
    setAltText(nextAlt);
    lastAltRef.current = nextAlt;
  }

  const nextIsFallback = nextColor === DEFAULT_BLUR_COLOR;
  if (
    nextColor !== blurColor &&
    (nextPreview !== preview ||
      (!hasColorOverride && (!nextIsFallback || blurColor === DEFAULT_BLUR_COLOR)))
  ) {
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
    lastAltRef.current = propInitialAltText || '';
    if (fileInputEl) fileInputEl.value = '';
  } else if (incomingObj?.url) {
    setUploadedData((prev) => (prev?.url === incomingObj.url ? prev : incomingObj));
  }
}
