import { type CSSProperties, type SyntheticEvent, useMemo } from 'react';
import { cx } from '../../utils/slotStyles';
import {
  DEFAULT_NEUTRAL_COLORS,
  resolveBackgroundColor,
  resolveIntrinsicPlaceholderUrl,
  resolvePlaceholderUrl,
} from './placeholder';
import type { AnimatedImageObjectFit, AnimatedImageProps } from './types';
import { useImageReveal } from './useImageReveal';

const preventDrag = (event: SyntheticEvent) => event.preventDefault();
const cn = (...classes: Parameters<typeof cx>) => cx(...classes) || undefined;

/**
 * Blur-up image with a smooth, GPU-friendly crossfade and subtle zoom reveal.
 * Matches the Imagine-Global reference design while remaining pure React,
 * SSR-safe, and framework-agnostic — plug in `next/image` via `as`.
 */
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
  objectPosition = 'center',
  showShimmer = false,
  animationDuration = 600,
  revealScale = 1.02,
  fallbackSrc,
  renderError,
  as: ImageComponent,
  imageComponentProps,
  unstyled = false,
  wrapperClassName,
  wrapperStyle,
  wrapperProps,
  placeholderClassName,
  className,
  style,
  loading: loadingProp,
  decoding = 'async',
  draggable = false,
  onLoad,
  onError,
  ...imgProps
}: AnimatedImageProps) {
  const src = srcProp ?? image?.url ?? '';
  const alt = altProp ?? image?.altText ?? '';
  const blurDataUrl = blurDataUrlProp ?? image?.blurDataUrl;
  const blurHash = blurHashProp ?? image?.blurHash;
  const blurColor = blurColorProp ?? image?.blurColor;
  const width = widthProp ?? (!fill ? image?.width : undefined);
  const height = heightProp ?? (!fill ? image?.height : undefined);

  const {
    activeSrc,
    retryKey,
    isLoaded,
    showPlaceholder,
    hasError,
    imgRef,
    handleLoad,
    handleError,
    retry,
  } = useImageReveal({
    srcKey: src,
    fallbackSrc,
    animationDuration,
    onLoad,
  });

  const placeholderUrl = useMemo(
    () =>
      colorPlaceholder === 'gradient'
        ? resolvePlaceholderUrl({ blurDataUrl, blurHash, blurColor, neutralColors })
        : resolveIntrinsicPlaceholderUrl({ blurDataUrl, blurHash }),
    [blurDataUrl, blurHash, blurColor, colorPlaceholder, neutralColors],
  );

  const state = hasError ? 'error' : isLoaded ? 'loaded' : 'loading';
  const resolvedObjectFit =
    (style?.objectFit as AnimatedImageObjectFit | undefined) ?? objectFit;
  const isContain = resolvedObjectFit === 'contain';
  const cls = (name: string) => (unstyled ? undefined : name);
  const duration = Math.max(0, animationDuration);
  const placeholderFadeDuration = Math.round(duration * (5 / 6));

  const containerStyle: CSSProperties = {
    backgroundColor:
      resolveBackgroundColor(blurColor, neutralColors) ??
      (unstyled
        ? undefined
        : 'var(--iuk-animated-image-bg, var(--background-card, rgba(38, 45, 56, 0.4)))'),
    ...(unstyled
      ? undefined
      : {
          ['--iuk-animated-image-duration' as string]: `${duration}ms`,
          ['--iuk-ai-ph-dur' as string]: `${placeholderFadeDuration}ms`,
          ['--iuk-animated-image-reveal-scale' as string]: String(revealScale),
        }),
    ...wrapperStyle,
  };

  const placeholderStyle: CSSProperties = {
    objectFit: isContain ? 'contain' : 'cover',
    transitionDuration: `${placeholderFadeDuration}ms`,
  };

  const imageStyle: CSSProperties = {
    objectFit: resolvedObjectFit,
    objectPosition,
    transitionDuration: `${duration}ms`,
    ...style,
    ...(hasError ? { opacity: 0, visibility: 'hidden' as const } : undefined),
  };

  const isCustom = Boolean(ImageComponent);
  const loadingAttr = priority
    ? isCustom
      ? undefined
      : 'eager'
    : (loadingProp ?? (isCustom ? undefined : 'lazy'));

  const priorityProps = isCustom
    ? {
        ...(priority !== undefined ? { priority } : {}),
        ...(quality !== undefined ? { quality } : {}),
      }
    : priority
      ? { fetchPriority: 'high' as const }
      : {};

  const derivedImageSrcSet =
    !isCustom && activeSrc === src
      ? (image?.srcSet ??
        (image?.variants?.length
          ? [
              ...[...image.variants]
                .sort((a, b) => a.width - b.width)
                .map((v) => `${v.url} ${v.width}w`),
              ...(image.width ? [`${src} ${image.width}w`] : []),
            ].join(', ')
          : undefined))
      : undefined;
  const resolvedSrcSet = imgProps.srcSet ?? derivedImageSrcSet;
  const resolvedSizes =
    !isCustom && resolvedSrcSet && fill && imgProps.sizes === undefined
      ? '100vw'
      : imgProps.sizes;

  const sharedImgProps = {
    ...priorityProps,
    ...imgProps,
    ...(resolvedSrcSet !== undefined ? { srcSet: resolvedSrcSet } : {}),
    ...(resolvedSizes !== undefined ? { sizes: resolvedSizes } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(loadingAttr !== undefined ? { loading: loadingAttr } : {}),
    src: activeSrc,
    alt,
    decoding,
    draggable,
    ref: imgRef,
    className: cn(cls('iuk-animated-image__img'), className),
    style: imageStyle,
    'data-state': state,
    onDragStart: imgProps.onDragStart ?? preventDrag,
    onLoad: (event: SyntheticEvent<HTMLImageElement>) =>
      handleLoad(event.currentTarget),
    onError: (event: SyntheticEvent<HTMLImageElement, Event>) => {
      const isTerminal = handleError();
      if (isTerminal) {
        onError?.(event);
      }
    },
  };

  return (
    <div
      {...wrapperProps}
      className={cn(
        cls('iuk-animated-image'),
        fill && cls('iuk-animated-image--fill'),
        isContain && cls('iuk-animated-image--contain'),
        wrapperClassName,
        wrapperProps?.className,
      )}
      style={{ ...containerStyle, ...wrapperProps?.style }}
      data-slot="animated-image"
      data-state={state}
      aria-busy={state === 'loading' || undefined}
    >
      {showPlaceholder && placeholderUrl && (
        <img
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          onDragStart={preventDrag}
          data-slot="animated-image-placeholder"
          className={cn(
            cls('iuk-animated-image__placeholder'),
            isLoaded && cls('iuk-animated-image__placeholder--hidden'),
            placeholderClassName,
          )}
          style={placeholderStyle}
        />
      )}

      {showShimmer && !isLoaded && !hasError && (
        <div
          aria-hidden="true"
          data-slot="animated-image-shimmer"
          className={cn(cls('iuk-animated-image__shimmer'))}
        />
      )}

      {ImageComponent ? (
        <ImageComponent
          key={retryKey > 0 ? retryKey : undefined}
          {...sharedImgProps}
          {...(fill ? { fill: true } : {})}
          {...imageComponentProps}
        />
      ) : (
        <img key={retryKey > 0 ? retryKey : undefined} {...sharedImgProps} />
      )}

      {hasError && renderError ? renderError({ src: activeSrc, retry }) : null}
    </div>
  );
}

export default AnimatedImage;
