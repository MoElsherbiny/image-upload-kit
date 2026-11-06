import {
  createFallbackBlurSvg,
  DEFAULT_NEUTRAL_COLORS,
  resolveBackgroundColor,
  resolveIntrinsicPlaceholderUrl,
  resolveMeaningfulColor,
  resolvePlaceholderUrl,
} from '../../core/placeholders';
import { createSignal } from '../signals';
import type { AngularImageRevealOptions, AngularSignal } from '../types';

export {
  createFallbackBlurSvg,
  DEFAULT_NEUTRAL_COLORS,
  resolveBackgroundColor,
  resolveIntrinsicPlaceholderUrl,
  resolveMeaningfulColor,
  resolvePlaceholderUrl,
};

const PLACEHOLDER_UNMOUNT_BUFFER_MS = 50;

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
