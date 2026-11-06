import type {
  QualityLevel,
  UploadedImageData,
  UploadPresetConfig,
} from '../../types';
import { DEFAULT_BLUR_COLOR } from '../../utils/color';

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
