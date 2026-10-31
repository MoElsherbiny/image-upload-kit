import {
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type SyntheticEvent,
  useMemo,
} from 'react';
import { cx } from '../../utils/slotStyles';
import { resolveMeaningfulColor, resolvePlaceholderUrl } from './placeholder';
import { useImageReveal } from './useImageReveal';

export type AnimatedImageObjectFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';

export interface AnimatedImageSource {
  url: string;
  altText?: string | null;
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
  width?: number;
  height?: number;
}

interface AnimatedImageBaseProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'onLoad' | 'onError' | 'placeholder'> {
  /** LQIP data URL (e.g. `UploadedImageData.blurDataUrl`). Highest priority placeholder. */
  blurDataUrl?: string | null;
  /** BlurHash string, decoded client-side when no `blurDataUrl` is given. */
  blurHash?: string | null;
  /** Dominant color (e.g. `UploadedImageData.blurColor`) used as background & gradient fallback. */
  blurColor?: string | null;
  /** Absolutely fill the nearest positioned parent (like `next/image` `fill`). */
  fill?: boolean;
  objectFit?: AnimatedImageObjectFit;
  objectPosition?: CSSProperties['objectPosition'];
  /** Show an animated shimmer while loading. Default `false`. */
  showShimmer?: boolean;
  /** Crossfade duration in ms. Default `700`. */
  animationDuration?: number;
  /** Render a custom image component (e.g. `next/image`, Gatsby, Astro). Receives all img props. */
  as?: ElementType;
  /** Extra props forwarded only to the `as` component (e.g. `{ quality: 80, priority: true }`). */
  imageComponentProps?: Record<string, unknown>;
  /** Strip all default `iuk-animated-image*` classes (bring your own CSS). */
  unstyled?: boolean;
  wrapperClassName?: string;
  wrapperStyle?: CSSProperties;
  wrapperProps?: HTMLAttributes<HTMLDivElement>;
  placeholderClassName?: string;
  /** Called after the image is decoded and the fade-in starts. */
  onLoad?: (img: HTMLImageElement | null) => void;
  onError?: (event: SyntheticEvent<HTMLImageElement, Event>) => void;
}

export type AnimatedImageProps = AnimatedImageBaseProps &
  (
    | {
        /** Direct `UploadedImageData` object returned by `<SingleImageUpload>` or `<MultiImageUpload>`. */
        image: AnimatedImageSource;
        src?: string;
        alt?: string;
      }
    | {
        image?: undefined;
        /** Image URL. */
        src: string;
        /** Accessible alt text (use `""` for decorative images). */
        alt: string;
      }
  );

const preventDrag = (event: SyntheticEvent) => event.preventDefault();
const cn = (...classes: Parameters<typeof cx>) => cx(...classes) || undefined;

/**
 * Blur-up image with a smooth, GPU-friendly crossfade from placeholder to sharp image.
 * Pure React, SSR-safe, framework-agnostic — plug in `next/image` via `as`.
 */
export function AnimatedImage({
  image,
  src: srcProp,
  alt: altProp,
  blurDataUrl: blurDataUrlProp,
  blurHash: blurHashProp,
  blurColor: blurColorProp,
  width: widthProp,
  height: heightProp,
  fill = false,
  objectFit = 'cover',
  objectPosition = 'center',
  showShimmer = false,
  animationDuration = 700,
  as: ImageComponent,
  imageComponentProps,
  unstyled = false,
  wrapperClassName,
  wrapperStyle,
  wrapperProps,
  placeholderClassName,
  className,
  style,
  loading = 'lazy',
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

  const { isLoaded, showPlaceholder, hasError, imgRef, handleLoad, handleError } = useImageReveal({
    srcKey: src,
    animationDuration,
    onLoad,
  });

  const placeholderUrl = useMemo(
    () => resolvePlaceholderUrl({ blurDataUrl, blurHash, blurColor }),
    [blurDataUrl, blurHash, blurColor],
  );

  const state = hasError ? 'error' : isLoaded ? 'loaded' : 'loading';
  const isContain = objectFit === 'contain';
  const cls = (name: string) => (unstyled ? undefined : name);
  const duration = Math.max(0, animationDuration);

  const containerStyle: CSSProperties = {
    backgroundColor: resolveMeaningfulColor(blurColor) ?? 'var(--iuk-animated-image-bg, rgba(38, 45, 56, 0.4))',
    ['--iuk-animated-image-duration' as string]: `${duration}ms`,
    ...wrapperStyle,
  };

  // Staggered fade: keep the placeholder opaque for the first 25% so the
  // background never "dips" through mid-transition.
  const placeholderStyle: CSSProperties = {
    objectFit: isContain ? 'contain' : 'cover',
    transitionDuration: `${Math.round(duration * 0.75)}ms`,
    transitionDelay: isLoaded ? `${Math.round(duration * 0.25)}ms` : '0ms',
  };

  const imageStyle: CSSProperties = {
    objectFit,
    objectPosition,
    transitionDuration: `${duration}ms`,
    ...style,
  };

  const sharedImgProps = {
    ...imgProps,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    src,
    alt,
    loading,
    decoding,
    draggable,
    ref: imgRef,
    className: cn(cls('iuk-animated-image__img'), className),
    style: imageStyle,
    'data-state': state,
    onDragStart: imgProps.onDragStart ?? preventDrag,
    onLoad: (event: SyntheticEvent<HTMLImageElement>) => handleLoad(event.currentTarget),
    onError: (event: SyntheticEvent<HTMLImageElement, Event>) => {
      handleError();
      onError?.(event);
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
      aria-busy={!isLoaded || undefined}
    >
      {showPlaceholder && (
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

      {showShimmer && showPlaceholder && (
        <div
          aria-hidden="true"
          data-slot="animated-image-shimmer"
          className={cn(
            cls('iuk-animated-image__shimmer'),
            isLoaded && cls('iuk-animated-image__shimmer--hidden'),
          )}
        />
      )}

      {ImageComponent ? (
        <ImageComponent {...sharedImgProps} {...(fill ? { fill: true } : {})} {...imageComponentProps} />
      ) : (
        <img {...sharedImgProps} />
      )}
    </div>
  );
}

export default AnimatedImage;
