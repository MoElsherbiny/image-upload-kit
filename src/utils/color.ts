export const DEFAULT_BLUR_COLOR = '#F5F5F5';

export function normalizeColorInput(value?: string | null): string | null {
  if (!value) return null;
  let next = value.trim();
  if (!next) return null;
  if (!next.startsWith('#')) {
    next = `#${next}`;
  }
  const threeHex = /^#([0-9a-fA-F]{3})$/;
  const sixHex = /^#([0-9a-fA-F]{6})$/;
  if (threeHex.test(next)) {
    const [, triplet] = next.match(threeHex) ?? [];
    if (triplet) {
      next = `#${triplet
        .split('')
        .map((char) => char + char)
        .join('')}`;
    }
  } else if (!sixHex.test(next)) {
    return null;
  }
  return next.toUpperCase();
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  const padded = expanded.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(padded, 16);
  if (Number.isNaN(value)) {
    return { r: 245, g: 245, b: 245 };
  }
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const value = (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
  return `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
}

function encodeBase64Ascii(str: string): string {
  if (typeof btoa === 'function') {
    return btoa(str);
  }
  return Buffer.from(str, 'utf8').toString('base64');
}

export function generateColorSvgDataURL(color: string = DEFAULT_BLUR_COLOR): string {
  const safeColor = normalizeColorInput(color) || DEFAULT_BLUR_COLOR;
  const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${safeColor}"/></svg>`;
  return `data:image/svg+xml;base64,${encodeBase64Ascii(svg)}`;
}
