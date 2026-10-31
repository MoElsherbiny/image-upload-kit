import { useMemo } from 'react';
import { blurService } from '../../blur/blurService';
import { DEFAULT_PLACEHOLDERS } from '../../blur/placeholders';
import type { BlurPlaceholderType, BlurSize } from '../../blur/types';

export function useBlurDataURL(
  imageSrc: string | undefined,
  options: {
    type?: BlurPlaceholderType;
    size?: BlurSize;
  } = {},
): string {
  const { type = 'default', size = 'small' } = options;

  return useMemo(() => {
    if (!imageSrc) return DEFAULT_PLACEHOLDERS[type];
    return blurService.getBlurDataURL(imageSrc, { type, size });
  }, [imageSrc, type, size]);
}

export function useBulkBlurData(
  imageSrcs: string[],
  options: {
    type?: BlurPlaceholderType;
    size?: BlurSize;
  } = {},
): Record<string, string> {
  const { type = 'default', size = 'small' } = options;

  return useMemo(() => {
    return blurService.getBulkBlurData(imageSrcs, { type, size });
  }, [imageSrcs, type, size]);
}

export function useProgressiveBlur(
  imageSrc: string | undefined,
  size: BlurSize = 'small',
) {
  return useMemo(() => {
    if (!imageSrc) {
      return {
        color: '#E5E7EB',
        blur: DEFAULT_PLACEHOLDERS.default,
        hasBlur: false,
      };
    }
    return blurService.getProgressiveData(imageSrc, size);
  }, [imageSrc, size]);
}

export function useHasBlurHash(imageSrc: string | undefined): boolean {
  return useMemo(() => {
    if (!imageSrc) return false;
    return blurService.hasBlurHash(imageSrc);
  }, [imageSrc]);
}

export function useDominantColor(imageSrc: string | undefined): string {
  return useMemo(() => {
    if (!imageSrc) return '#E5E7EB';
    return blurService.getDominantColor(imageSrc);
  }, [imageSrc]);
}

export function useBlurMetadata() {
  return useMemo(() => {
    return blurService.getMetadata();
  }, []);
}

export function useBlurHash(imageSrc: string | undefined): string | null {
  return useMemo(() => {
    if (!imageSrc) return null;
    return blurService.getBlurHash(imageSrc);
  }, [imageSrc]);
}

export function useBlurDataWithColor(
  imageSrc: string | undefined,
  size: BlurSize = 'small',
): {
  blurDataUrl: string;
  blurColor: string;
  hasBlur: boolean;
} {
  return useMemo(() => {
    if (!imageSrc) {
      return {
        blurDataUrl: DEFAULT_PLACEHOLDERS.default,
        blurColor: '#E5E7EB',
        hasBlur: false,
      };
    }
    const progressive = blurService.getProgressiveData(imageSrc, size);
    return {
      blurDataUrl: progressive.blur,
      blurColor: progressive.color,
      hasBlur: progressive.hasBlur,
    };
  }, [imageSrc, size]);
}

export function useBlurVariant(
  imageSrc: string | undefined,
  size: BlurSize = 'small',
  type: BlurPlaceholderType = 'default',
): string {
  return useMemo(() => {
    if (!imageSrc) return DEFAULT_PLACEHOLDERS[type];
    return blurService.getBlurDataURL(imageSrc, { type, size });
  }, [imageSrc, size, type]);
}

export { blurService, DEFAULT_PLACEHOLDERS };
export type { BlurPlaceholderType, BlurSize };
