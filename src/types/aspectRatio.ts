/**
 * Standard social, e-commerce, and editorial aspect ratios.
 * - `'1:1'` — Square (e-commerce product galleries, Instagram square posts, avatars)
 * - `'4:5'` — Portrait feed (Instagram / social vertical feed posts, 1080×1350)
 * - `'3:4'` — Classic portrait (catalog cards)
 * - `'4:3'` — Classic landscape
 * - `'3:2'` — DSLR photo landscape
 * - `'16:10'` — Editorial / studio stage landscape
 * - `'16:9'` — Widescreen cover / video thumbnail
 * - `'9:16'` — Story / Reel / vertical full-screen (1080×1920)
 * - `'auto'` — Preserve intrinsic image ratio
 * - `number` — Custom numeric width/height ratio (e.g. `1.91` for OG social cards)
 */
export type ImageAspectRatio =
  | '1:1'
  | '4:5'
  | '3:4'
  | '4:3'
  | '3:2'
  | '16:10'
  | '16:9'
  | '9:16'
  | 'auto'
  | number;

export type CropStrategy = 'attention' | 'entropy' | 'center';

const NAMED_ASPECT_RATIOS: Record<string, { numeric: number; css: string }> = {
  '1:1': { numeric: 1, css: '1 / 1' },
  '4:5': { numeric: 4 / 5, css: '4 / 5' },
  '3:4': { numeric: 3 / 4, css: '3 / 4' },
  '4:3': { numeric: 4 / 3, css: '4 / 3' },
  '3:2': { numeric: 3 / 2, css: '3 / 2' },
  '16:10': { numeric: 16 / 10, css: '16 / 10' },
  '16:9': { numeric: 16 / 9, css: '16 / 9' },
  '9:16': { numeric: 9 / 16, css: '9 / 16' },
};

/**
 * Resolves an `ImageAspectRatio` to a positive numeric `width / height` ratio.
 * Returns `undefined` for `'auto'`, `undefined`, or unparseable inputs.
 */
export function resolveAspectRatio(
  ratio: ImageAspectRatio | string | undefined,
): number | undefined {
  if (ratio === undefined || ratio === null || ratio === 'auto') {
    return undefined;
  }
  if (typeof ratio === 'number') {
    return Number.isFinite(ratio) && ratio > 0 ? ratio : undefined;
  }
  const trimmed = ratio.trim();
  const named = NAMED_ASPECT_RATIOS[trimmed];
  if (named) return named.numeric;

  const parts = trimmed.split(/[:/]/).map((part) => Number(part.trim()));
  if (
    parts.length === 2 &&
    Number.isFinite(parts[0]) &&
    Number.isFinite(parts[1]) &&
    parts[0] > 0 &&
    parts[1] > 0
  ) {
    return parts[0] / parts[1];
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Converts an `ImageAspectRatio` into a valid CSS `aspect-ratio` string
 * (e.g. `'4:5'` -> `'4 / 5'`, `1.5` -> `'1.5'`, `'auto'` -> `'auto'`).
 */
export function aspectRatioToCss(
  ratio: ImageAspectRatio | string | undefined,
): string | undefined {
  if (ratio === undefined || ratio === null) return undefined;
  if (ratio === 'auto') return 'auto';
  if (typeof ratio === 'number') {
    return Number.isFinite(ratio) && ratio > 0 ? String(ratio) : undefined;
  }
  const trimmed = ratio.trim();
  if (NAMED_ASPECT_RATIOS[trimmed]) {
    return NAMED_ASPECT_RATIOS[trimmed].css;
  }
  const numeric = resolveAspectRatio(trimmed);
  if (numeric === undefined) return undefined;
  if (trimmed.includes(':') || trimmed.includes('/')) {
    const [w, h] = trimmed.split(/[:/]/).map((s) => Number(s.trim()));
    return `${w} / ${h}`;
  }
  return String(numeric);
}

export const resolveAspectRatioNumber = resolveAspectRatio;
export const resolveAspectRatioCss = aspectRatioToCss;
