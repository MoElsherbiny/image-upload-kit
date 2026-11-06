import {
  type ComputedRef,
  computed,
  getCurrentScope,
  type MaybeRefOrGetter,
  onScopeDispose,
  type Ref,
  ref,
  toValue,
  watch,
} from 'vue';
import {
  createFallbackBlurSvg,
  DEFAULT_NEUTRAL_COLORS,
  resolveBackgroundColor,
  resolveIntrinsicPlaceholderUrl,
  resolveMeaningfulColor,
  resolvePlaceholderUrl,
} from '../../core/placeholders';
import type { VueImageRevealOptions } from '../types';

export {
  createFallbackBlurSvg,
  DEFAULT_NEUTRAL_COLORS,
  resolveBackgroundColor,
  resolveIntrinsicPlaceholderUrl,
  resolveMeaningfulColor,
  resolvePlaceholderUrl,
};

const PLACEHOLDER_UNMOUNT_BUFFER_MS = 50;

export interface VueImageRevealController {
  state: ComputedRef<'loading' | 'loaded' | 'error'>;
  effectiveSrc: Ref<string>;
  activeSrc: Ref<string>;
  retryKey: Ref<number>;
  isLoaded: Ref<boolean>;
  hasError: Ref<boolean>;
  showPlaceholder: Ref<boolean>;
  placeholderUrl: ComputedRef<string | undefined>;
  bgColor: ComputedRef<string | undefined>;
  handleLoad: (img?: HTMLImageElement | null) => void;
  handleError: () => boolean;
  retry: () => void;
  destroy: () => void;
}

export function useImageReveal(
  optionsInput: MaybeRefOrGetter<VueImageRevealOptions>,
): VueImageRevealController {
  const resolveOpts = (): VueImageRevealOptions => toValue(optionsInput);
  const initialOpts = resolveOpts();
  const initialPrimarySrc = initialOpts.src ?? initialOpts.image?.url ?? '';

  const effectiveSrc = ref<string>(initialPrimarySrc);
  const retryKey = ref<number>(0);
  const isLoaded = ref<boolean>(false);
  const hasError = ref<boolean>(false);
  const showPlaceholder = ref<boolean>(true);

  let usingFallback = false;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const state = computed<'loading' | 'loaded' | 'error'>(() => {
    if (hasError.value) return 'error';
    if (isLoaded.value) return 'loaded';
    return 'loading';
  });

  const placeholderUrl = computed<string | undefined>(() => {
    const opts = resolveOpts();
    const isContain = opts.objectFit === 'contain';
    const colorPlaceholder = opts.colorPlaceholder ?? 'flat';
    const neutralColors = opts.neutralColors ?? DEFAULT_NEUTRAL_COLORS;
    const blurDataUrl = opts.blurDataUrl ?? opts.image?.blurDataUrl;
    const blurHash = opts.blurHash ?? opts.image?.blurHash;
    const blurColor = opts.blurColor ?? opts.image?.blurColor;

    return colorPlaceholder === 'gradient' || isContain
      ? resolvePlaceholderUrl({ blurDataUrl, blurHash, blurColor, neutralColors })
      : resolveIntrinsicPlaceholderUrl({ blurDataUrl, blurHash });
  });

  const bgColor = computed<string | undefined>(() => {
    const opts = resolveOpts();
    const blurColor = opts.blurColor ?? opts.image?.blurColor;
    const neutralColors = opts.neutralColors ?? DEFAULT_NEUTRAL_COLORS;
    return resolveBackgroundColor(blurColor, neutralColors);
  });

  watch(
    () => {
      const opts = resolveOpts();
      return opts.src ?? opts.image?.url ?? '';
    },
    (nextPrimary, prevPrimary) => {
      if (nextPrimary !== prevPrimary) {
        clearTimer();
        usingFallback = false;
        isLoaded.value = false;
        hasError.value = false;
        showPlaceholder.value = true;
        effectiveSrc.value = nextPrimary;
      }
    },
  );

  const handleLoad = (img?: HTMLImageElement | null) => {
    const loadedFor = effectiveSrc.value;
    const reveal = () => {
      if (destroyed || loadedFor !== effectiveSrc.value) return;
      const opts = resolveOpts();
      const duration = Math.max(0, opts.animationDuration ?? 600);
      const isContain = opts.objectFit === 'contain';

      hasError.value = false;
      isLoaded.value = true;
      clearTimer();
      if (!isContain) {
        timer = setTimeout(() => {
          if (!destroyed) showPlaceholder.value = false;
          timer = null;
        }, duration + PLACEHOLDER_UNMOUNT_BUFFER_MS);
      }
      opts.onLoad?.(img ?? null);
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
    const opts = resolveOpts();
    const primarySrc = opts.src ?? opts.image?.url ?? '';
    const fallbackSrc = opts.fallbackSrc;

    if (fallbackSrc && !usingFallback && fallbackSrc !== primarySrc) {
      usingFallback = true;
      isLoaded.value = false;
      showPlaceholder.value = true;
      hasError.value = false;
      effectiveSrc.value = fallbackSrc;
      return false;
    }

    hasError.value = true;
    isLoaded.value = false;
    showPlaceholder.value = true;
    opts.onError?.();
    return true;
  };

  const retry = () => {
    if (destroyed) return;
    clearTimer();
    const opts = resolveOpts();
    const primarySrc = opts.src ?? opts.image?.url ?? '';
    usingFallback = false;
    hasError.value = false;
    isLoaded.value = false;
    showPlaceholder.value = true;
    effectiveSrc.value = primarySrc;
    retryKey.value += 1;
  };

  const destroy = () => {
    destroyed = true;
    clearTimer();
  };

  if (getCurrentScope()) {
    onScopeDispose(destroy);
  }

  return {
    state,
    effectiveSrc,
    activeSrc: effectiveSrc,
    retryKey,
    isLoaded,
    hasError,
    showPlaceholder,
    placeholderUrl,
    bgColor,
    handleLoad,
    handleError,
    retry,
    destroy,
  };
}
