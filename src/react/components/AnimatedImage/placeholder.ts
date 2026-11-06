import { decodeBlurHashToDataURL } from '../../../blur/blurDataUtils';

/**
 * Default neutral colors that carry no real information about the image (common
 * DB defaults or "empty" values). Ignored by default so placeholders never
 * flash pitch-black or stark white unless `neutralColors={[]}` is passed.
 */
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
  for (const item of neutralColors) {
    if (item.toLowerCase() === lower) return true;
  }
  return false;
}

/**
 * Returns a safe, meaningful literal color (`#hex`, `rgb(...)`, `hsl(...)`, `oklch(...)`)
 * suitable for inline SVG embedding, or `undefined` when empty/neutral/invalid.
 * Rejects CSS variables (`var(--*)`) because SVG data URLs cannot resolve host DOM tokens.
 */
export function resolveMeaningfulColor(
  color?: string | null,
  neutralColors: readonly string[] = DEFAULT_NEUTRAL_COLORS,
): string | undefined {
  const value = color?.trim();
  if (!value) return undefined;
  if (isNeutralColor(value, neutralColors)) return undefined;
  if (!HEX_COLOR.test(value) && !FUNC_COLOR.test(value)) return undefined;
  return value;
}

/**
 * Returns a safe CSS background-color value for the wrapper element.
 * Accepts literal colors AND safe CSS custom property expressions (`var(--token)`),
 * while rejecting neutral defaults and CSS injection payloads.
 */
export function resolveBackgroundColor(
  color?: string | null,
  neutralColors: readonly string[] = DEFAULT_NEUTRAL_COLORS,
): string | undefined {
  const value = color?.trim();
  if (!value) return undefined;
  if (isNeutralColor(value, neutralColors)) return undefined;
  if (HEX_COLOR.test(value) || FUNC_COLOR.test(value) || CSS_VAR_COLOR.test(value)) {
    return value;
  }
  return undefined;
}

/**
 * Inline SVG data URL that renders a soft gradient placeholder.
 * Uses the dominant color when provided, otherwise a neutral slate gradient.
 */
export function createFallbackBlurSvg(
  color?: string | null,
  neutralColors: readonly string[] = DEFAULT_NEUTRAL_COLORS,
): string {
  const meaningful = resolveMeaningfulColor(color, neutralColors);
  const stop1 = meaningful ?? '#2c3340';
  const stop2 = meaningful ? '#0f172a' : '#1e242d';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%">' +
    '<defs>' +
    '<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
    `<stop offset="0%" stop-color="${stop1}" stop-opacity="1"/>` +
    `<stop offset="55%" stop-color="${stop1}" stop-opacity="0.78"/>` +
    `<stop offset="100%" stop-color="${stop2}" stop-opacity="0.96"/>` +
    '</linearGradient>' +
    '<radialGradient id="h" cx="24%" cy="22%" r="65%">' +
    '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>' +
    '<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>' +
    '</radialGradient>' +
    '</defs>' +
    '<rect width="100%" height="100%" fill="url(#g)"/>' +
    '<rect width="100%" height="100%" fill="url(#h)"/>' +
    '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface PlaceholderSources {
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
  neutralColors?: readonly string[];
}

/**
 * Resolves an intrinsic image placeholder (`blurDataUrl` or decoded `blurHash`)
 * without falling back to an SVG gradient. Returns `undefined` when neither is present.
 */
export function resolveIntrinsicPlaceholderUrl({
  blurDataUrl,
  blurHash,
}: Pick<PlaceholderSources, 'blurDataUrl' | 'blurHash'>): string | undefined {
  const dataUrl = blurDataUrl?.trim();
  if (dataUrl) return dataUrl;
  if (blurHash && typeof document !== 'undefined') {
    try {
      const decoded = decodeBlurHashToDataURL(blurHash, 32, 32);
      if (decoded) return decoded;
    } catch {
      // Invalid hash: ignore.
    }
  }
  return undefined;
}

/**
 * Resolves the best available placeholder URL in priority order:
 * 1. `blurDataUrl` (LQIP data URL / remote URL)
 * 2. `blurHash` (decoded client-side; browser only)
 * 3. Gradient SVG derived from `blurColor` (or neutral fallback)
 */
export function resolvePlaceholderUrl({
  blurDataUrl,
  blurHash,
  blurColor,
  neutralColors = DEFAULT_NEUTRAL_COLORS,
}: PlaceholderSources): string {
  const intrinsic = resolveIntrinsicPlaceholderUrl({ blurDataUrl, blurHash });
  if (intrinsic) return intrinsic;
  return createFallbackBlurSvg(blurColor, neutralColors);
}
