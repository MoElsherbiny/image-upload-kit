import type { SvgAttribute } from './svgTokenizer';

const ALLOWED_ELEMENTS_LIST = [
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'circle', 'ellipse',
  'rect', 'line', 'polyline', 'polygon', 'linearGradient', 'radialGradient',
  'stop', 'clipPath', 'mask', 'pattern', 'symbol', 'use', 'text', 'tspan',
  'style', 'marker', 'image', 'filter', 'feBlend', 'feColorMatrix',
  'feComposite', 'feFlood', 'feGaussianBlur', 'feMerge', 'feMergeNode',
  'feOffset', 'feDropShadow',
] as const;

const ALLOWED_ELEMENT_MAP = new Map<string, string>(
  ALLOWED_ELEMENTS_LIST.map((tag) => [tag.toLowerCase(), tag]),
);

const ALLOWED_ATTRIBUTES = new Set<string>([
  'xmlns', 'xmlns:xlink', 'version', 'viewbox', 'preserveaspectratio',
  'id', 'class', 'style', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill',
  'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-miterlimit', 'opacity', 'color', 'stop-color', 'stop-opacity',
  'offset', 'gradientunits', 'gradienttransform', 'spreadmethod', 'fx', 'fy',
  'clip-path', 'clip-rule', 'mask', 'maskunits', 'maskcontentunits',
  'patternunits', 'patterncontentunits', 'patterntransform', 'filter',
  'stddeviation', 'dx', 'dy', 'in', 'in2', 'mode', 'result', 'flood-color',
  'flood-opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'letter-spacing',
  'word-spacing', 'text-decoration', 'writing-mode', 'role', 'aria-label',
  'aria-hidden', 'aria-labelledby', 'aria-describedby', 'focusable',
  'tabindex', 'xml:space', 'lang', 'dir', 'marker-start', 'marker-mid',
  'marker-end', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient',
  'markerunits', 'vector-effect', 'shape-rendering', 'paint-order',
  'display', 'visibility', 'overflow', 'href', 'xlink:href', 'type',
]);

const ALLOWED_XMLNS_VALUES = new Set<string>([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
]);

const SAFE_NAMED_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const SAFE_HREF_FRAGMENT_RE = /^#[a-zA-Z0-9_.:-]+$/;
const SAFE_DATA_IMAGE_RE =
  /^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=\s]+$/i;

function stripControlAndSpace(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x20) out += str[i];
  }
  return out;
}

export function decodeHtmlEntitiesForCheck(value: string): string {
  const decoded = value
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);?/g, (_, dec: string) => {
      const cp = Number.parseInt(dec, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
  return stripControlAndSpace(decoded);
}

export function stripUnsafeEntities(text: string): string {
  return text.replace(/&([a-zA-Z_][\w.-]*);/g, (full, name: string) =>
    SAFE_NAMED_ENTITIES.has(name) ? full : '',
  );
}

export function resolveAllowedSvgTag(rawName: string): string | null {
  const lower = rawName.toLowerCase();
  if (lower.includes(':')) {
    const [prefix, local] = lower.split(':', 2);
    if (prefix !== 'svg' || !local) return null;
    return ALLOWED_ELEMENT_MAP.get(local) ?? null;
  }
  return ALLOWED_ELEMENT_MAP.get(lower) ?? null;
}

function isSafeFragmentHref(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!SAFE_HREF_FRAGMENT_RE.test(trimmed)) return false;
  const decoded = decodeHtmlEntitiesForCheck(trimmed);
  return SAFE_HREF_FRAGMENT_RE.test(decoded);
}

function isSafeImageHref(rawValue: string): boolean {
  if (isSafeFragmentHref(rawValue)) return true;
  const trimmed = rawValue.trim();
  const decoded = decodeHtmlEntitiesForCheck(trimmed);
  return SAFE_DATA_IMAGE_RE.test(trimmed) && SAFE_DATA_IMAGE_RE.test(decoded);
}

function normalizeCssObfuscation(css: string): string {
  let current = css;
  for (let i = 0; i < 4; i++) {
    const next = current
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
        const cp = Number.parseInt(hex, 16);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      })
      .replace(/\\([^\r\n0-9a-fA-F])/g, '$1');
    if (next === current) break;
    current = next;
  }
  return current;
}

export function sanitizeCssBlock(css: string): string {
  const normalized = stripUnsafeEntities(normalizeCssObfuscation(css));
  return normalized
    .replace(/@(?:import|charset|namespace)\b[^;{}]*(?:;|$)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/(?:javascript|vbscript|data)\s*:[^;)"'}]*/gi, '')
    .replace(/-moz-binding\s*:[^;}"']*/gi, '')
    .replace(/behavior\s*:[^;}"']*/gi, '')
    .replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, _q, target: string) => {
      const cleaned = decodeHtmlEntitiesForCheck(target.trim());
      return SAFE_HREF_FRAGMENT_RE.test(cleaned) ? full : 'none';
    });
}

function escapeAttrValue(value: string): string {
  return stripUnsafeEntities(value)
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function hasDangerousScheme(value: string): boolean {
  const decoded = decodeHtmlEntitiesForCheck(value).toLowerCase();
  return (
    decoded.includes('javascript:') ||
    decoded.includes('vbscript:') ||
    decoded.includes('data:text/') ||
    decoded.includes('data:image/svg')
  );
}

export function sanitizeSvgAttributes(
  canonicalTag: string,
  attrs: SvgAttribute[],
): string {
  const kept: string[] = [];

  for (const attr of attrs) {
    const lowerName = attr.name.toLowerCase();
    const localName = lowerName.includes(':')
      ? lowerName.split(':', 2)[1]
      : lowerName;

    if (lowerName.startsWith('on') || localName.startsWith('on')) continue;
    if (!ALLOWED_ATTRIBUTES.has(lowerName)) continue;

    const rawValue = attr.value;

    if (lowerName === 'xmlns' || lowerName === 'xmlns:xlink') {
      const trimmed = rawValue.trim();
      if (!ALLOWED_XMLNS_VALUES.has(trimmed)) continue;
      kept.push(`${attr.name}="${trimmed}"`);
      continue;
    }

    if (lowerName === 'href' || lowerName === 'xlink:href') {
      const allowed =
        canonicalTag === 'image'
          ? isSafeImageHref(rawValue)
          : isSafeFragmentHref(rawValue);
      if (!allowed) continue;
      kept.push(`${attr.name}="${escapeAttrValue(rawValue.trim())}"`);
      continue;
    }

    if (lowerName === 'style') {
      const cleanStyle = sanitizeCssBlock(rawValue).replace(/"/g, "'").trim();
      if (cleanStyle) kept.push(`style="${escapeAttrValue(cleanStyle)}"`);
      continue;
    }

    if (hasDangerousScheme(rawValue)) continue;

    if (/url\s*\(/i.test(rawValue)) {
      const cleanUrl = sanitizeCssBlock(rawValue).trim();
      if (cleanUrl) kept.push(`${attr.name}="${escapeAttrValue(cleanUrl)}"`);
      continue;
    }

    kept.push(`${attr.name}="${escapeAttrValue(rawValue)}"`);
  }

  return kept.length > 0 ? ` ${kept.join(' ')}` : '';
}
