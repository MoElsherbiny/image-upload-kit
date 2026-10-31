import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseImageRevealOptions {
  /** Identity of the current source; a change resets the reveal state. */
  srcKey: string;
  /** Crossfade duration in ms. */
  animationDuration: number;
  onLoad?: (img: HTMLImageElement | null) => void;
}

export interface ImageRevealState {
  /** True once the sharp image is decoded and ready to fade in. */
  isLoaded: boolean;
  /** Whether the placeholder layer is still mounted (kept until fade completes). */
  showPlaceholder: boolean;
  /** True when the image failed to load. */
  hasError: boolean;
  /** Callback ref to attach to the underlying `<img>` element. */
  imgRef: (node: HTMLImageElement | null) => void;
  handleLoad: (img?: HTMLImageElement | null) => void;
  handleError: () => void;
}

/**
 * Framework-agnostic reveal state machine for blur-up images:
 * - resets synchronously when `srcKey` changes (no stale 1-frame flash)
 * - pre-decodes via `HTMLImageElement.decode()` before crossfading
 * - detects already-cached images after the first paint
 * - keeps the placeholder mounted until the crossfade finishes, then unmounts it
 * - clears all timers / animation frames on unmount
 */
export function useImageReveal({ srcKey, animationDuration, onLoad }: UseImageRevealOptions): ImageRevealState {
  const [prevSrc, setPrevSrc] = useState(srcKey);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [node, setNode] = useState<HTMLImageElement | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const srcRef = useRef(srcKey);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  const clearTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Synchronous reset during render when the source changes.
  if (prevSrc !== srcKey) {
    setPrevSrc(srcKey);
    setIsLoaded(false);
    setShowPlaceholder(true);
    setHasError(false);
  }

  useEffect(() => {
    srcRef.current = srcKey;
    clearTimer();
  }, [srcKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, []);

  const handleLoad = useCallback(
    (img?: HTMLImageElement | null) => {
      const el = img ?? node;
      const loadedFor = srcRef.current;
      const reveal = () => {
        // Ignore stale decodes from a previous src or after unmount.
        if (!mountedRef.current || loadedFor !== srcRef.current) return;
        setIsLoaded(true);
        clearTimer();
        timeoutRef.current = setTimeout(() => {
          if (mountedRef.current) setShowPlaceholder(false);
          timeoutRef.current = null;
        }, animationDuration + 200);
        onLoadRef.current?.(el ?? null);
      };
      if (el && typeof el.decode === 'function') {
        el.decode().then(reveal, reveal);
      } else {
        reveal();
      }
    },
    [animationDuration, node],
  );

  const handleError = useCallback(() => {
    if (!mountedRef.current) return;
    clearTimer();
    setHasError(true);
    setIsLoaded(true);
    setShowPlaceholder(false);
  }, []);

  // Cached images may finish before React attaches onLoad: wait one frame so
  // the placeholder paints first, then reveal.
  useEffect(() => {
    if (!node || !node.complete || node.naturalWidth === 0) return;
    if (typeof requestAnimationFrame !== 'function') {
      handleLoad(node);
      return;
    }
    const rafId = requestAnimationFrame(() => handleLoad(node));
    return () => cancelAnimationFrame(rafId);
  }, [node, srcKey, handleLoad]);

  return { isLoaded, showPlaceholder, hasError, imgRef: setNode, handleLoad, handleError };
}
