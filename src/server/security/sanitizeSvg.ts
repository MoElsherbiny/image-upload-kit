import { UploadValidationError } from '../handler/responses';
import {
  resolveAllowedSvgTag,
  sanitizeCssBlock,
  sanitizeSvgAttributes,
  stripUnsafeEntities,
} from './svgAllowlist';
import { tokenizeSvg } from './svgTokenizer';

export const DEFAULT_MAX_SVG_BYTES = 1024 * 1024; // 1 MB

export interface SanitizeSvgOptions {
  maxBytes?: number;
  /**
   * Optional custom sanitizer hook invoked before the built-in strict XML allowlist pass.
   * Useful for plugging in organization-specific SVG preprocessing or DOMPurify.
   */
  customSanitizer?: (svg: string) => string;
}

function escapeTextNode(text: string): string {
  return stripUnsafeEntities(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function assertByteLimit(byteLength: number, maxBytes: number): void {
  if (byteLength > maxBytes) {
    throw new UploadValidationError(
      `SVG file size (${byteLength} bytes) exceeds maximum allowed SVG size of ${maxBytes} bytes`,
      { code: 'FILE_TOO_LARGE', status: 413 },
    );
  }
}

/**
 * Dependency-free strict XML/SVG allowlist sanitizer.
 * Tokenizes XML, rejects malformed markup and unclosed elements, strips
 * `<!DOCTYPE>`/`<!ENTITY>`/comments/CDATA/PIs, allows only safe SVG elements
 * and attributes, sanitizes `<style>`/`style` CSS, and blocks dangerous URIs.
 */
export function sanitizeSvg(
  input: Buffer | string,
  options: SanitizeSvgOptions = {},
): Buffer {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_SVG_BYTES;
  const initialByteLength =
    typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.length;
  assertByteLimit(initialByteLength, maxBytes);

  let svg = typeof input === 'string' ? input : input.toString('utf8');
  svg = svg.replace(/^\uFEFF/, '');

  if (typeof options.customSanitizer === 'function') {
    svg = options.customSanitizer(svg);
    if (typeof svg !== 'string') {
      throw new UploadValidationError(
        'Invalid SVG: customSanitizer must return a string',
        { code: 'INVALID_IMAGE' },
      );
    }
    assertByteLimit(Buffer.byteLength(svg, 'utf8'), maxBytes);
  }

  const tokens = tokenizeSvg(svg);
  const out: string[] = [];
  const openStack: string[] = [];
  const skipStack: string[] = [];
  let sawRootSvg = false;

  for (const token of tokens) {
    if (token.type === 'open') {
      const lowerRaw = token.name.toLowerCase();
      if (skipStack.length > 0) {
        if (!token.selfClosing) skipStack.push(lowerRaw);
        continue;
      }

      const canonical = resolveAllowedSvgTag(token.name);
      if (!canonical) {
        if (!token.selfClosing) skipStack.push(lowerRaw);
        continue;
      }

      const isRootSvg = canonical === 'svg' && openStack.length === 0 && !sawRootSvg;
      if (canonical === 'svg') sawRootSvg = true;
      let cleanAttrs = sanitizeSvgAttributes(canonical, token.attrs);
      if (isRootSvg && !/(?:^|\s)xmlns="/i.test(cleanAttrs)) {
        cleanAttrs = ` xmlns="http://www.w3.org/2000/svg"${cleanAttrs}`;
      }
      if (token.selfClosing) {
        out.push(`<${canonical}${cleanAttrs}/>`);
      } else {
        openStack.push(canonical);
        out.push(`<${canonical}${cleanAttrs}>`);
      }
      continue;
    }

    if (token.type === 'close') {
      const lowerRaw = token.name.toLowerCase();
      if (skipStack.length > 0) {
        const matchIdx = skipStack.lastIndexOf(lowerRaw);
        if (matchIdx !== -1) {
          skipStack.length = matchIdx;
        }
        continue;
      }

      const canonical = resolveAllowedSvgTag(token.name);
      if (!canonical) continue;

      const expected = openStack.pop();
      if (expected !== canonical) {
        throw new UploadValidationError(
          `Invalid SVG: mismatched closing tag </${token.name}>`,
          { code: 'INVALID_IMAGE' },
        );
      }
      out.push(`</${canonical}>`);
      continue;
    }

    // Text token
    if (skipStack.length > 0) continue;
    const currentTag = openStack[openStack.length - 1];
    if (currentTag === 'style') {
      out.push(sanitizeCssBlock(token.value));
    } else if (openStack.length > 0) {
      out.push(escapeTextNode(token.value));
    }
  }

  if (skipStack.length > 0) {
    throw new UploadValidationError(
      `Invalid SVG: unclosed disallowed element <${skipStack[0]}>`,
      { code: 'INVALID_IMAGE' },
    );
  }
  if (openStack.length > 0) {
    throw new UploadValidationError(
      `Invalid SVG: unclosed XML element <${openStack[openStack.length - 1]}>`,
      { code: 'INVALID_IMAGE' },
    );
  }

  const sanitized = out.join('').trim();
  if (!sawRootSvg || !/<svg[\s>/]/i.test(sanitized)) {
    throw new UploadValidationError(
      'Invalid SVG: missing root <svg> element after sanitization',
      { code: 'INVALID_IMAGE' },
    );
  }

  // Final defense-in-depth safety verification
  if (
    /<\s*(?:[a-zA-Z0-9_-]+:)?(?:script|foreignObject|iframe|object|embed)\b/i.test(
      sanitized,
    ) ||
    /<!(?:DOCTYPE|ENTITY)\b/i.test(sanitized) ||
    /\bon[a-z]+\s*=/i.test(sanitized) ||
    /(?:javascript|vbscript)\s*:/i.test(sanitized)
  ) {
    throw new UploadValidationError(
      'Invalid SVG: unsafe content remained after sanitization',
      { code: 'INVALID_IMAGE' },
    );
  }

  return Buffer.from(sanitized, 'utf8');
}
