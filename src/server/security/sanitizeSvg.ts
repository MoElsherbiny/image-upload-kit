import { UploadValidationError } from '../handler/responses';

export const DEFAULT_MAX_SVG_BYTES = 1024 * 1024; // 1 MB

const FORBIDDEN_ELEMENTS = [
  'script',
  'foreignObject',
  'iframe',
  'embed',
  'object',
  'applet',
  'meta',
  'link',
  'base',
  'audio',
  'video',
  'canvas',
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
  'handler',
  'listener',
  'tbreak',
];

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

function decodeHtmlEntitiesForCheck(value: string): string {
  const decoded = value
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16) || 0),
    )
    .replace(/&#(\d+);?/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10) || 0),
    );
  return stripControlAndSpace(decoded);
}

function isSafeSvgHref(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (SAFE_HREF_FRAGMENT_RE.test(trimmed)) return true;
  const decoded = decodeHtmlEntitiesForCheck(trimmed);
  if (SAFE_HREF_FRAGMENT_RE.test(decoded)) return true;
  if (SAFE_DATA_IMAGE_RE.test(trimmed) && SAFE_DATA_IMAGE_RE.test(decoded)) {
    return true;
  }
  return false;
}

function normalizeCssObfuscation(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/\\([^\r\n0-9a-fA-F])/g, '$1');
}

function sanitizeCssBlock(css: string): string {
  return normalizeCssObfuscation(css)
    .replace(/@import\b[^;{}]*(?:;|$)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/(?:javascript|vbscript|data)\s*:[^;)"']*/gi, '')
    .replace(/-moz-binding\s*:[^;}"']*/gi, '')
    .replace(/behavior\s*:[^;}"']*/gi, '')
    .replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, _q, target: string) => {
      const cleaned = decodeHtmlEntitiesForCheck(target.trim());
      return SAFE_HREF_FRAGMENT_RE.test(cleaned) ? full : 'none';
    });
}

function sanitizeTagAttributes(attrs: string): string {
  const attrRe =
    /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  const kept: string[] = [];
  for (const match of attrs.matchAll(attrRe)) {
    const rawName = match[1];
    const lowerName = rawName.toLowerCase();
    const localName = lowerName.includes(':')
      ? lowerName.split(':')[1]
      : lowerName;
    const rawValue = match[2] ?? match[3] ?? match[4] ?? '';

    // Strip all event handler attributes (onload, onclick, onbegin, etc.)
    if (lowerName.startsWith('on') || localName.startsWith('on')) {
      continue;
    }

    // Check href / xlink:href / src / action / formaction / data
    if (
      localName === 'href' ||
      lowerName === 'xlink:href' ||
      localName === 'src' ||
      localName === 'action' ||
      localName === 'formaction' ||
      localName === 'data'
    ) {
      if (!isSafeSvgHref(rawValue)) {
        continue;
      }
      const escaped = rawValue.replace(/"/g, '&quot;');
      kept.push(`${rawName}="${escaped}"`);
      continue;
    }

    if (localName === 'style') {
      const cleanStyle = sanitizeCssBlock(rawValue).replace(/"/g, "'");
      if (cleanStyle.trim()) {
        kept.push(`style="${cleanStyle}"`);
      }
      continue;
    }

    // Reject javascript: / data: / vbscript: inside any other attribute (e.g. fill="url(https://...)")
    const decodedVal = decodeHtmlEntitiesForCheck(rawValue).toLowerCase();
    if (
      decodedVal.includes('javascript:') ||
      decodedVal.includes('vbscript:') ||
      decodedVal.includes('data:text/') ||
      decodedVal.includes('data:image/svg')
    ) {
      continue;
    }

    if (/url\s*\(/i.test(rawValue)) {
      const sanitizedUrlAttr = sanitizeCssBlock(rawValue).replace(/"/g, '&quot;');
      kept.push(`${rawName}="${sanitizedUrlAttr}"`);
      continue;
    }

    if (match[2] !== undefined || match[3] !== undefined || match[4] !== undefined) {
      kept.push(`${rawName}="${rawValue.replace(/"/g, '&quot;')}"`);
    } else {
      kept.push(rawName);
    }
  }

  return kept.length > 0 ? ` ${kept.join(' ')}` : '';
}

export interface SanitizeSvgOptions {
  maxBytes?: number;
}

/**
 * Dependency-free SVG sanitizer.
 * Strips `<script>`, `<foreignObject>`, `<iframe|embed|object>`, `<!DOCTYPE>`/`<!ENTITY>`,
 * custom XML entities, `on*` event attributes, and non-fragment / non-raster-data `href`s.
 */
export function sanitizeSvg(
  input: Buffer | string,
  options: SanitizeSvgOptions = {},
): Buffer {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SVG_BYTES;
  const byteLength =
    typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.length;

  if (byteLength > maxBytes) {
    throw new UploadValidationError(
      `SVG file size (${byteLength} bytes) exceeds maximum allowed SVG size of ${maxBytes} bytes`,
    );
  }

  let svg = typeof input === 'string' ? input : input.toString('utf8');
  svg = svg.replace(/^\uFEFF/, '');

  // Strip <!DOCTYPE ... [ ... ]> and standalone <!ENTITY ...>
  svg = svg.replace(/<!DOCTYPE[^[>]*(?:\[[\s\S]*?\]\s*)?>/gi, '');
  svg = svg.replace(/<!ENTITY[\s\S]*?>/gi, '');

  // Strip comments, CDATA, and non-xml processing instructions
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  svg = svg.replace(/<\?(?!xml\b)[\s\S]*?\?>/gi, '');

  // Strip custom / external XML entity references like &xxe;
  svg = svg.replace(/&([a-zA-Z_][\w.-]*);/g, (full, name: string) =>
    SAFE_NAMED_ENTITIES.has(name) ? full : '',
  );

  // Iteratively strip forbidden elements and their inner subtrees
  const tagPattern = FORBIDDEN_ELEMENTS.join('|');
  const pairedRe = new RegExp(
    `<\\s*(?:[a-zA-Z0-9_-]+:)?(?:${tagPattern})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*(?:[a-zA-Z0-9_-]+:)?(?:${tagPattern})\\s*>`,
    'gi',
  );
  const singleRe = new RegExp(
    `<\\s*\\/?\\s*(?:[a-zA-Z0-9_-]+:)?(?:${tagPattern})\\b[^>]*\\/?>`,
    'gi',
  );
  const htmlNamespaceRe =
    /<\s*\/?\s*(?:xhtml|html):[a-zA-Z0-9_-]+\b[^>]*\/?>/gi;

  for (let pass = 0; pass < 4; pass++) {
    const prev = svg;
    svg = svg
      .replace(pairedRe, '')
      .replace(singleRe, '')
      .replace(htmlNamespaceRe, '');
    if (svg === prev) break;
  }

  // Sanitize <style> blocks
  svg = svg.replace(
    /(<\s*style\b[^>]*>)([\s\S]*?)(<\s*\/\s*style\s*>)/gi,
    (_m, open: string, body: string, close: string) =>
      `${open}${sanitizeCssBlock(body)}${close}`,
  );

  // Sanitize attributes on every remaining opening/self-closing tag
  svg = svg.replace(
    /<([a-zA-Z_:][\w:.-]*)(\s[^<>]*?)?(\s*\/?)>/g,
    (_full, tagName: string, attrs: string | undefined, selfClose: string) => {
      const cleanAttrs = attrs ? sanitizeTagAttributes(attrs) : '';
      return `<${tagName}${cleanAttrs}${selfClose}>`;
    },
  );

  if (!/<svg[\s>/]/i.test(svg)) {
    throw new UploadValidationError(
      'Invalid SVG: missing root <svg> element after sanitization',
    );
  }

  // Post-sanitization safety verification
  if (
    pairedRe.test(svg) ||
    singleRe.test(svg) ||
    /<!(?:DOCTYPE|ENTITY)\b/i.test(svg) ||
    /\bon[a-z]+\s*=/i.test(svg) ||
    /(?:javascript|vbscript)\s*:/i.test(svg)
  ) {
    throw new UploadValidationError(
      'Invalid SVG: unsafe content remained after sanitization',
    );
  }

  return Buffer.from(svg.trim(), 'utf8');
}
