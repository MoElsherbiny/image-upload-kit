import { decodeBlurHashToDataURL } from '../../blur/blurDataUtils';
import { createSignal } from '../signals';
import type { AngularImageRevealOptions, AngularSignal } from '../types';

export const DEFAULT_NEUTRAL_COLORS = [
  '#1a1a1a', '#121212', '#000000', '#000', '#e5e7eb', '#ffffff', '#fff',
] as const;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla|oklch|oklab)\([\d\s.,%/+-]+\)$/i;
const CSS_VAR_COLOR = /^var\(--[a-zA-Z0-9_-]+(?:\s*,\s*[^;{}<>()]+)?\)$/;
const PLACEHOLDER_UNMOUNT_BUFFER_MS = 50;

function isNeutralColor(value: string, neutralColors: readonly string[]): boolean {
  if (neutralColors.length === 0) return false;
  const lower = value.toLowerCase();
  return neutralColors.some((item) => item.toLowerCase() === lower);
}

export function resolveMeaningfulColor(
  color?: string | null,
  neutralColors: readonly string[] = DEFAULT_NEUTRAL_COLORS,
): string | undefined {
  const value = color?.trim();
  if (!value || isNeutralColor(value, neutralColors)) return undefined;
  return HEX_COLOR.test(value) || FUNC_COLOR.test(value) ? value : undefined;
}

export function resolveBackgroundColor(
  color?: string | null,
  neutralColors: readonly string[] = DEFAULT_NEUTRAL_COLORS,
): string | undefined {
  const value = color?.trim();
  if (!value || isNeutralColor(value, neutralColors)) return undefined;
  return HEX_COLOR.test(value) || FUNC_COLOR.test(value) || CSS_VAR_COLOR.test(value)
    ? value
    : undefined;
}

export function createFallbackBlurSvg(
  color?: string | null,
  neutralColors: readonly string[] = DEFAULT_NEUTRAL_COLORS,
): string {
  const meaningful = resolveMeaningfulColor(color, neutralColors);
  const stop1 = meaningful ?? '#2c3340';
  const stop2 = meaningful ? '#0f172a' : '#1e242d';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">' +
    '<defs>' +
    '<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
    `<stop offset="0%" stop-color="${stop1}" stop-opacity="1"/>` +
    `<stop offset="55%" stop-color="${stop1}" stop-opacity="0.78"/>` +
    `<stop offset="100%" stop-color="${stop2}" stop-opacity="0.96"/>` +
    '</linearGradient>' +
    '<radialGradient id="h" cx="24%" cy="22%" r="65%">' +
    '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>' +
    '<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>' +
    '</radialGradient>' +
    '</defs>' +
    '<rect width="100%" height="100%" fill="url(#g)"/>' +
    '<rect width="100%" height="100%" fill="url(#h)"/>' +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function resolveIntrinsicPlaceholderUrl(sources: {
  blurDataUrl?: string | null;
  blurHash?: string | null;
}): string | undefined {
  const dataUrl = sources.blurDataUrl?.trim();
  if (dataUrl) return dataUrl;
  if (sources.blurHash && typeof document !== 'undefined') {
    try {
      const decoded = decodeBlurHashToDataURL(sources.blurHash, 32, 32);
      if (decoded) return decoded;
    } catch {
      // Ignore invalid BlurHash
    }
  }
  return undefined;
}

export function resolvePlaceholderUrl(sources: {
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
  neutralColors?: readonly string[];
}): string {
  return (
    resolveIntrinsicPlaceholderUrl(sources) ??
    createFallbackBlurSvg(sources.blurColor, sources.neutralColors)
  );
}

export interface AngularImageRevealController {
  state: AngularSignal<'loading' | 'loaded' | 'error'>;
  isLoaded: AngularSignal<boolean>;
  showPlaceholder: AngularSignal<boolean>;
  hasError: AngularSignal<boolean>;
  activeSrc: AngularSignal<string>;
  retryKey: AngularSignal<number>;
  placeholderUrl: string | undefined;
  handleLoad: (img?: HTMLImageElement | null) => void;
  handleError: () => boolean;
  retry: () => void;
  destroy: () => void;
}

export function createImageReveal(
  options: AngularImageRevealOptions,
): AngularImageRevealController {
  const primarySrc = options.src ?? options.image?.url ?? '';
  const fallbackSrc = options.fallbackSrc;
  const duration = Math.max(0, options.animationDuration ?? 600);
  const isContain = options.objectFit === 'contain';
  const colorPlaceholder = options.colorPlaceholder ?? 'flat';
  const neutralColors = options.neutralColors ?? DEFAULT_NEUTRAL_COLORS;
  const blurDataUrl = options.blurDataUrl ?? options.image?.blurDataUrl;
  const blurHash = options.blurHash ?? options.image?.blurHash;
  const blurColor = options.blurColor ?? options.image?.blurColor;

  const placeholderUrl =
    colorPlaceholder === 'gradient' || isContain
      ? resolvePlaceholderUrl({ blurDataUrl, blurHash, blurColor, neutralColors })
      : resolveIntrinsicPlaceholderUrl({ blurDataUrl, blurHash });

  const state = createSignal<'loading' | 'loaded' | 'error'>('loading');
  const isLoaded = createSignal<boolean>(false);
  const showPlaceholder = createSignal<boolean>(true);
  const hasError = createSignal<boolean>(false);
  const activeSrc = createSignal<string>(primarySrc);
  const retryKey = createSignal<number>(0);

  let usingFallback = false;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const handleLoad = (img?: HTMLImageElement | null) => {
    const loadedFor = activeSrc();
    const reveal = () => {
      if (destroyed || loadedFor !== activeSrc()) return;
      hasError.set(false);
      isLoaded.set(true);
      state.set('loaded');
      clearTimer();
      if (!isContain) {
        timer = setTimeout(() => {
          if (!destroyed) showPlaceholder.set(false);
          timer = null;
        }, duration + PLACEHOLDER_UNMOUNT_BUFFER_MS);
      }
      options.onLoad?.(img ?? null);
    };
    if (img && typeof img.decode === 'function') {
      img.decode().then(reveal, reveal);
    } else {
      reveal();
    }
  };

  const handleError = (): boolean => {
    if (destroyed) return false;
    clearTimer();
    if (fallbackSrc && !usingFallback && fallbackSrc !== primarySrc) {
      usingFallback = true;
      isLoaded.set(false);
      showPlaceholder.set(true);
      hasError.set(false);
      state.set('loading');
      activeSrc.set(fallbackSrc);
      return false;
    }
    hasError.set(true);
    isLoaded.set(false);
    showPlaceholder.set(true);
    state.set('error');
    options.onError?.();
    return true;
  };

  const retry = () => {
    if (destroyed) return;
    clearTimer();
    usingFallback = false;
    hasError.set(false);
    isLoaded.set(false);
    showPlaceholder.set(true);
    state.set('loading');
    activeSrc.set(primarySrc);
    retryKey.update((k) => k + 1);
  };

  const destroy = () => {
    destroyed = true;
    clearTimer();
  };

  return {
    state, isLoaded, showPlaceholder, hasError, activeSrc, retryKey, placeholderUrl,
    handleLoad, handleError, retry, destroy,
  };
}
