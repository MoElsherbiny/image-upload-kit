import { decodeBlurHashToDataURL } from '../../../blur/blurDataUtils';

/**
 * Colors that carry no real information about the image (common DB defaults
 * or "empty" values). They are replaced by a neutral slate gradient so the
 * placeholder never flashes pitch-black or stark white.
 */
const NEUTRAL_COLORS = new Set(['#1a1a1a', '#121212', '#000000', '#000', '#e5e7eb', '#ffffff', '#fff']);

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla|oklch|oklab)\([\d\s.,%/+-]+\)$/i;

/** Returns a safe, meaningful color or `undefined` when the value is empty/neutral/invalid. */
export function resolveMeaningfulColor(color?: string | null): string | undefined {
  const value = color?.trim();
  if (!value) return undefined;
  if (NEUTRAL_COLORS.has(value.toLowerCase())) return undefined;
  // Guard against CSS/SVG injection: only accept plain color literals.
  if (!HEX_COLOR.test(value) && !FUNC_COLOR.test(value)) return undefined;
  return value;
}

/**
 * Inline SVG data URL that renders a soft gradient placeholder.
 * Uses the dominant color when provided, otherwise a neutral slate gradient.
 */
export function createFallbackBlurSvg(color?: string | null): string {
  const meaningful = resolveMeaningfulColor(color);
  const stop1 = meaningful ?? '#2c3340';
  const stop2 = meaningful ?? '#1e242d';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">' +
    '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
    `<stop offset="0%" stop-color="${stop1}" stop-opacity="0.95"/>` +
    `<stop offset="100%" stop-color="${stop2}" stop-opacity="0.9"/>` +
    '</linearGradient></defs>' +
    '<rect width="100%" height="100%" fill="url(#g)"/></svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface PlaceholderSources {
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
}

/**
 * Resolves the best available placeholder in priority order:
 * 1. `blurDataUrl` (LQIP data URL / remote URL)
 * 2. `blurHash` (decoded client-side; browser only)
 * 3. Gradient SVG derived from `blurColor` (or neutral fallback)
 */
export function resolvePlaceholderUrl({ blurDataUrl, blurHash, blurColor }: PlaceholderSources): string {
  const dataUrl = blurDataUrl?.trim();
  if (dataUrl) return dataUrl;
  if (blurHash && typeof document !== 'undefined') {
    try {
      const decoded = decodeBlurHashToDataURL(blurHash, 32, 32);
      if (decoded) return decoded;
    } catch {
      // Invalid hash: fall through to color gradient.
    }
  }
  return createFallbackBlurSvg(blurColor);
}
