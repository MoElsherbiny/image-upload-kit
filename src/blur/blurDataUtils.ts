import { decode as decodeBlurHash, isBlurhashValid } from './vendor/blurhash';
import type { BlurData, BlurImageSource } from './types';

export interface BlurPlaceholderStyle {
  backgroundColor: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  filter?: string;
  transform?: string;
}

function formatCssUrl(rawUrl: string): string {
  const escaped = rawUrl
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, '');
  return `url("${escaped}")`;
}

export function getBlurData(
  image: BlurImageSource | null | undefined,
): BlurData {
  if (!image) {
    return {
      blurDataUrl: '',
      blurColor: '#E5E7EB',
      hasBlur: false,
    };
  }

  return {
    blurDataUrl: image.blurDataUrl || '',
    blurColor: image.blurColor || '#E5E7EB',
    ...(image.blurHash ? { blurHash: image.blurHash } : {}),
    hasBlur: Boolean(image.blurDataUrl || image.blurHash),
  };
}

export function getImagePropsWithBlur(
  image: BlurImageSource | null | undefined,
) {
  if (!image?.url) {
    return null;
  }

  const blurData = getBlurData(image);

  return {
    src: image.url,
    alt: image.altText || '',
    width: image.width || 1920,
    height: image.height || 1080,
    ...(blurData.blurDataUrl && {
      placeholder: 'blur' as const,
      blurDataURL: blurData.blurDataUrl,
    }),
  };
}

export function getBackgroundPropsWithBlur(
  image: BlurImageSource | null | undefined,
): BlurPlaceholderStyle {
  if (!image?.url) {
    return {
      backgroundColor: '#E5E7EB',
    };
  }

  const blurData = getBlurData(image);

  return {
    backgroundColor: blurData.blurColor,
    backgroundImage: formatCssUrl(image.url),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
}

export function getBlurPlaceholderStyle(
  image: BlurImageSource | null | undefined,
): BlurPlaceholderStyle {
  const blurData = getBlurData(image);

  if (!blurData.blurDataUrl) {
    return {
      backgroundColor: blurData.blurColor,
    };
  }

  return {
    backgroundColor: blurData.blurColor,
    backgroundImage: formatCssUrl(blurData.blurDataUrl),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(20px)',
    transform: 'scale(1.1)',
  };
}

export function hasBlurData(
  image: BlurImageSource | null | undefined,
): boolean {
  return Boolean(image?.blurDataUrl || image?.blurColor || image?.blurHash);
}

export function getBulkBlurData(
  images: Array<BlurImageSource | null | undefined>,
): BlurData[] {
  return images.map(getBlurData);
}

/**
 * Builds a responsive `srcset` descriptor for the full-resolution image URL.
 * Never includes the low-resolution LQIP placeholder in `srcset` so browsers
 * cannot accidentally select the blurred placeholder as the final image.
 */
export function createSrcSetWithBlur(
  image: BlurImageSource | null | undefined,
): string {
  if (!image?.url) return '';
  if (image.width && image.width > 0) {
    return `${image.url} ${image.width}w`;
  }
  return image.url;
}

/**
 * Preloads the target image URL in `document.head` via `<link rel="preload" as="image">`.
 * Does not set `imagesrcset` to the LQIP data URL and deduplicates existing preload links.
 */
export function preloadImageWithBlur(
  image: BlurImageSource | null | undefined,
): void {
  if (!image?.url || typeof document === 'undefined' || !document.head) return;

  const existingLinks = document.head.querySelectorAll(
    'link[rel="preload"][as="image"]',
  );
  for (let i = 0; i < existingLinks.length; i++) {
    const el = existingLinks[i] as HTMLLinkElement;
    if (el.getAttribute('href') === image.url || el.href === image.url) {
      return;
    }
  }

  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = image.url;
  document.head.appendChild(link);
}

export function extractImageUrls(
  image: BlurImageSource | null | undefined,
): string[] {
  if (!image?.url) return [];
  return [image.url];
}

/**
 * Browser helper: Decodes a compact BlurHash string (e.g. "LEHV6nWB2yk8pyo0adR*.7kCMdnj")
 * into a `data:image/png;base64,...` URL using an offscreen `<canvas>`.
 */
export function decodeBlurHashToDataURL(
  hash: string,
  width: number = 32,
  height: number = 32,
  punch: number = 1,
): string | null {
  if (!hash || typeof document === 'undefined') return null;
  const validation = isBlurhashValid(hash);
  if (!validation.result) return null;

  try {
    const pixels = decodeBlurHash(hash, width, height, punch);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
