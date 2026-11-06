import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseImageRevealOptions {
  /** Identity of the primary source; a change resets the reveal state. */
  srcKey: string;
  /** Optional fallback URL tried once if `srcKey` fails to load. */
  fallbackSrc?: string;
  /** Crossfade duration in ms. */
  animationDuration: number;
  onLoad?: (img: HTMLImageElement | null) => void;
}

export interface ImageRevealState {
  /** Active image URL (`srcKey` initially, or `fallbackSrc` after primary failure). */
  activeSrc: string;
  /** Monotonic counter incremented when `retry()` is invoked. */
  retryKey: number;
  /** True once the sharp image is decoded and ready to fade in. */
  isLoaded: boolean;
  /** Whether the placeholder layer is still mounted (kept until fade completes, or on error). */
  showPlaceholder: boolean;
  /** True when the image (and optional `fallbackSrc`) failed to load. */
  hasError: boolean;
  /** Callback ref to attach to the underlying `<img>` element. */
  imgRef: (node: HTMLImageElement | null) => void;
  handleLoad: (img?: HTMLImageElement | null) => void;
  /** Returns `true` if the error is terminal, or `false` if switching to `fallbackSrc`. */
  handleError: () => boolean;
  /** Resets error state and retries loading from the primary `srcKey`. */
  retry: () => void;
}

const PLACEHOLDER_UNMOUNT_BUFFER_MS = 50;

/**
 * Framework-agnostic reveal state machine for blur-up images:
 * - resets synchronously when `srcKey` changes (no stale 1-frame flash)
 * - pre-decodes via `HTMLImageElement.decode()` before crossfading
 * - detects already-cached images after the first paint
 * - unmounts placeholder after crossfade (`animationDuration + 50ms`)
 * - on error: tries `fallbackSrc` once if provided; on terminal error keeps placeholder visible
 */
export function useImageReveal({
  srcKey,
  fallbackSrc,
  animationDuration,
  onLoad,
}: UseImageRevealOptions): ImageRevealState {
  const [prevSrc, setPrevSrc] = useState(srcKey);
  const [usingFallback, setUsingFallback] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [node, setNode] = useState<HTMLImageElement | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const activeSrc = usingFallback && fallbackSrc ? fallbackSrc : srcKey;
  const activeSrcRef = useRef(activeSrc);
  const onLoadRef = useRef(onLoad);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  if (prevSrc !== srcKey) {
    setPrevSrc(srcKey);
    setUsingFallback(false);
    setIsLoaded(false);
    setShowPlaceholder(true);
    setHasError(false);
  }

  useEffect(() => {
    activeSrcRef.current = activeSrc;
    clearTimer();
  }, [activeSrc, clearTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const handleLoad = useCallback(
    (img?: HTMLImageElement | null) => {
      const el = img ?? node;
      const loadedFor = activeSrcRef.current;
      const reveal = () => {
        if (!mountedRef.current || loadedFor !== activeSrcRef.current) return;
        setHasError(false);
        setIsLoaded(true);
        clearTimer();
        const duration = Math.max(0, animationDuration);
        timeoutRef.current = setTimeout(() => {
          if (mountedRef.current) setShowPlaceholder(false);
          timeoutRef.current = null;
        }, duration + PLACEHOLDER_UNMOUNT_BUFFER_MS);
        onLoadRef.current?.(el ?? null);
      };
      if (el && typeof el.decode === 'function') {
        el.decode().then(reveal, reveal);
      } else {
        reveal();
      }
    },
    [animationDuration, clearTimer, node],
  );

  const handleError = useCallback((): boolean => {
    if (!mountedRef.current) return false;
    clearTimer();
    if (fallbackSrc && !usingFallback && fallbackSrc !== srcKey) {
      setUsingFallback(true);
      setIsLoaded(false);
      setShowPlaceholder(true);
      setHasError(false);
      return false;
    }
    setHasError(true);
    setIsLoaded(false);
    setShowPlaceholder(true);
    return true;
  }, [clearTimer, fallbackSrc, srcKey, usingFallback]);

  const retry = useCallback(() => {
    clearTimer();
    setUsingFallback(false);
    setHasError(false);
    setIsLoaded(false);
    setShowPlaceholder(true);
    setRetryKey((prev) => prev + 1);
  }, [clearTimer]);

  useEffect(() => {
    if (!node || !node.complete || node.naturalWidth === 0) return;
    if (typeof requestAnimationFrame !== 'function') {
      handleLoad(node);
      return;
    }
    const rafId = requestAnimationFrame(() => handleLoad(node));
    return () => cancelAnimationFrame(rafId);
  }, [node, activeSrc, retryKey, handleLoad]);

  return {
    activeSrc,
    retryKey,
    isLoaded,
    showPlaceholder,
    hasError,
    imgRef: setNode,
    handleLoad,
    handleError,
    retry,
  };
}
