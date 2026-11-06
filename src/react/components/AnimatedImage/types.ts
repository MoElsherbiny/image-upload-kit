import type {
  CSSProperties,
  ElementType,
  HTMLAttributes,
  ImgHTMLAttributes,
  ReactNode,
  SyntheticEvent,
} from 'react';

export type AnimatedImageObjectFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';

export type AnimatedImageColorPlaceholder = 'flat' | 'gradient';

export interface AnimatedImageSource {
  url: string;
  altText?: string | null;
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
  width?: number;
  height?: number;
}

export interface AnimatedImageErrorContext {
  src: string;
  retry: () => void;
}

export interface AnimatedImageBaseProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    'src' | 'alt' | 'onLoad' | 'onError' | 'placeholder'
  > {
  /** LQIP data URL (e.g. `UploadedImageData.blurDataUrl`). Highest priority placeholder. */
  blurDataUrl?: string | null;
  /** BlurHash string, decoded client-side when no `blurDataUrl` is given. */
  blurHash?: string | null;
  /** Dominant color or CSS variable (e.g. `'#3b82f6'` or `'var(--background-card)'`) used as wrapper background. */
  blurColor?: string | null;
  /**
   * Placeholder behavior when only `blurColor` is available (no `blurDataUrl` or `blurHash`):
   * - `'flat'` (default): uses flat `blurColor` wrapper background with no extra placeholder `<img>` layer (Imagine-Global parity).
   * - `'gradient'`: mounts an inline SVG gradient placeholder `<img>`.
   */
  colorPlaceholder?: AnimatedImageColorPlaceholder;
  /**
   * Neutral colors ignored by `resolveBackgroundColor` / `resolveMeaningfulColor`.
   * Defaults to `DEFAULT_NEUTRAL_COLORS`. Pass `[]` to allow all colors (including `#000000` / `#ffffff`).
   */
  neutralColors?: readonly string[];
  /** Absolutely fill the nearest positioned parent (like `next/image` `fill`). */
  fill?: boolean;
  /**
   * Mark image as high-priority above-the-fold content:
   * - Native `<img>`: sets `loading="eager"` and `fetchPriority="high"`.
   * - Custom `as={Image}`: forwards `priority={true}` and omits default `loading="lazy"`.
   */
  priority?: boolean;
  /**
   * Image quality hint (1–100) forwarded only when `as` is provided (e.g. `next/image`).
   * Never rendered as a DOM attribute on a native `<img>`.
   */
  quality?: number;
  objectFit?: AnimatedImageObjectFit;
  objectPosition?: CSSProperties['objectPosition'];
  /** Show an animated shimmer while loading. Unmounted once loaded. Default `false`. */
  showShimmer?: boolean;
  /** Reveal transition duration in ms. Default `600`. */
  animationDuration?: number;
  /** Initial scale of the image before reveal (`scale(revealScale) -> scale(1)`). Default `1.02` (`1` = pure fade). */
  revealScale?: number;
  /** Optional fallback image URL tried once if the primary `src` fails to load. */
  fallbackSrc?: string;
  /** Optional custom error overlay rendered when image loading fails. */
  renderError?: (ctx: AnimatedImageErrorContext) => ReactNode;
  /** Render a custom image component (e.g. `next/image`, Gatsby, Astro). Receives all img props. */
  as?: ElementType;
  /** Extra props forwarded only to the `as` component. */
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
