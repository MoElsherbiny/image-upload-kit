import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveAspectRatio } from '../../types';
import {
  flattenNativeStyle,
  NativeImage,
  type NativeResizeMode,
  type NativeStyleObject,
  NativeView,
} from '../primitives';
import type { NativeAnimatedImageProps } from '../types';

export const DEFAULT_NEUTRAL_COLORS = [
  '#1a1a1a',
  '#121212',
  '#000000',
  '#000',
  '#e5e7eb',
  '#ffffff',
  '#fff',
] as const;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla|oklch|oklab)\([\d\s.,%/+-]+\)$/i;
const CSS_VAR_COLOR = /^var\(--[a-zA-Z0-9_-]+(?:\s*,\s*[^;{}<>()]+)?\)$/;

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
    '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
    `<stop offset="0%" stop-color="${stop1}" stop-opacity="1"/>` +
    `<stop offset="55%" stop-color="${stop1}" stop-opacity="0.78"/>` +
    `<stop offset="100%" stop-color="${stop2}" stop-opacity="0.96"/>` +
    '</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mapObjectFitToResizeMode(
  objectFit?: NativeAnimatedImageProps['objectFit'],
  resizeMode?: NativeResizeMode,
): NativeResizeMode {
  if (resizeMode) return resizeMode;
  if (objectFit === 'contain' || objectFit === 'scale-down') return 'contain';
  if (objectFit === 'fill') return 'stretch';
  if (objectFit === 'none') return 'center';
  return 'cover';
}

export function AnimatedImage({
  image,
  src: srcProp,
  alt: altProp,
  blurDataUrl: blurDataUrlProp,
  blurHash: blurHashProp,
  blurColor: blurColorProp,
  colorPlaceholder = 'flat',
  neutralColors = DEFAULT_NEUTRAL_COLORS,
  width: widthProp,
  height: heightProp,
  fill = false,
  priority,
  quality,
  objectFit = 'cover',
  resizeMode: resizeModeProp,
  aspectRatio,
  revealScale = 1.02,
  animationDuration = 600,
  reduceMotion = false,
  fallbackSrc,
  renderError,
  as: CustomImage,
  imageComponentProps,
  style,
  wrapperStyle,
  testID,
  onLoad,
  onError,
}: NativeAnimatedImageProps) {
  const src = srcProp ?? image?.url ?? '';
  const alt = altProp ?? image?.altText ?? '';
  const blurDataUrl = blurDataUrlProp ?? image?.blurDataUrl;
  const blurHash = blurHashProp ?? image?.blurHash;
  const blurColor = blurColorProp ?? image?.blurColor;
  const width = widthProp ?? (!fill ? image?.width : undefined);
  const height = heightProp ?? (!fill ? image?.height : undefined);

  const [activeSrc, setActiveSrc] = useState(src);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const triedFallbackRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setActiveSrc(src);
    setIsLoaded(false);
    setShowPlaceholder(true);
    setHasError(false);
    triedFallbackRef.current = false;
  }, [src]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const resolvedResizeMode = mapObjectFitToResizeMode(objectFit, resizeModeProp);
  const isContain = resolvedResizeMode === 'contain' || objectFit === 'contain';
  const numericAspectRatio = resolveAspectRatio(aspectRatio);

  const placeholderUri = useMemo(() => {
    const trimmed = blurDataUrl?.trim();
    if (trimmed) return trimmed;
    if (colorPlaceholder === 'gradient' || isContain) {
      return createFallbackBlurSvg(blurColor, neutralColors);
    }
    return undefined;
  }, [blurDataUrl, blurColor, colorPlaceholder, isContain, neutralColors]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    setHasError(false);
    onLoad?.();
    if (!isContain) {
      const waitMs = reduceMotion ? 0 : Math.max(0, animationDuration) + 50;
      if (waitMs === 0) setShowPlaceholder(false);
      else timerRef.current = setTimeout(() => setShowPlaceholder(false), waitMs);
    }
  }, [animationDuration, isContain, onLoad, reduceMotion]);

  const handleError = useCallback(() => {
    if (fallbackSrc && !triedFallbackRef.current && activeSrc !== fallbackSrc) {
      triedFallbackRef.current = true;
      setActiveSrc(fallbackSrc);
      return;
    }
    setHasError(true);
    setShowPlaceholder(true);
    onError?.();
  }, [activeSrc, fallbackSrc, onError]);

  const retry = useCallback(() => {
    triedFallbackRef.current = false;
    setHasError(false);
    setIsLoaded(false);
    setShowPlaceholder(true);
    setActiveSrc(src);
    setRetryKey((k) => k + 1);
  }, [src]);

  const state = hasError ? 'error' : isLoaded ? 'loaded' : 'loading';
  const bgColor = resolveBackgroundColor(blurColor, neutralColors) ?? '#1e293b';

  const containerStyle: NativeStyleObject = {
    position: fill ? 'absolute' : 'relative',
    overflow: 'hidden',
    backgroundColor: bgColor,
    ...(fill ? { top: 0, right: 0, bottom: 0, left: 0 } : {}),
    ...(numericAspectRatio !== undefined ? { aspectRatio: numericAspectRatio } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(flattenNativeStyle(wrapperStyle) as NativeStyleObject),
  };

  const mainImageStyle: NativeStyleObject = {
    width: '100%',
    height: '100%',
    opacity: hasError ? 0 : isLoaded || reduceMotion ? 1 : 0,
    transform: reduceMotion || isLoaded ? 'scale(1)' : `scale(${revealScale})`,
    ...(flattenNativeStyle(style) as NativeStyleObject),
  };

  const expoPlaceholder = blurHash ? { blurhash: blurHash } : undefined;

  return (
    <NativeView
      testID={testID}
      data-slot="animated-image"
      data-state={state}
      accessibilityState={{ busy: state === 'loading' }}
      style={containerStyle}
    >
      {(showPlaceholder || isContain || hasError) && placeholderUri ? (
        <NativeImage
          data-slot="animated-image-placeholder"
          source={{ uri: placeholderUri }}
          alt=""
          resizeMode="cover"
          blurRadius={20}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            width: '100%',
            height: '100%',
            opacity: isContain || !isLoaded || hasError ? 1 : 0,
          }}
        />
      ) : null}

      {CustomImage ? (
        <CustomImage
          key={retryKey > 0 ? retryKey : undefined}
          source={{ uri: activeSrc }}
          src={activeSrc}
          alt={alt}
          accessibilityLabel={alt}
          resizeMode={resolvedResizeMode}
          contentFit={resolvedResizeMode}
          placeholder={expoPlaceholder}
          priority={priority}
          quality={quality}
          data-slot="animated-image-main"
          data-state={state}
          style={mainImageStyle}
          onLoad={handleLoad}
          onError={handleError}
          {...imageComponentProps}
        />
      ) : (
        <NativeImage
          key={retryKey > 0 ? retryKey : undefined}
          source={{ uri: activeSrc }}
          alt={alt}
          accessibilityLabel={alt}
          resizeMode={resolvedResizeMode}
          data-slot="animated-image-main"
          data-state={state}
          style={mainImageStyle}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}

      {hasError && renderError ? renderError({ src: activeSrc, retry }) : null}
    </NativeView>
  );
}

export default AnimatedImage;
