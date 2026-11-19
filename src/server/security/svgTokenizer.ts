import { UploadValidationError } from '../handler/responses';

export interface SvgAttribute {
  name: string;
  value: string;
}

export type SvgToken =
  | { type: 'open'; name: string; attrs: SvgAttribute[]; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; value: string };

const NAME_CHAR_RE = /^[a-zA-Z0-9_.:-]$/;
const NAME_START_RE = /^[a-zA-Z_:]$/;

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

function skipWhitespace(src: string, pos: number): number {
  while (pos < src.length && isWhitespace(src[pos])) pos++;
  return pos;
}

function readName(src: string, start: number): { name: string; next: number } {
  if (start >= src.length || !NAME_START_RE.test(src[start])) {
    throw new UploadValidationError('Invalid SVG: malformed XML identifier', {
      code: 'INVALID_IMAGE',
    });
  }
  let pos = start + 1;
  while (pos < src.length && NAME_CHAR_RE.test(src[pos])) pos++;
  return { name: src.slice(start, pos), next: pos };
}

function skipDeclaration(src: string, start: number): number {
  // Comment: <!-- ... -->
  if (src.startsWith('<!--', start)) {
    const end = src.indexOf('-->', start + 4);
    if (end === -1) {
      throw new UploadValidationError('Invalid SVG: unclosed XML comment', {
        code: 'INVALID_IMAGE',
      });
    }
    return end + 3;
  }

  // CDATA: <![CDATA[ ... ]]>
  if (src.startsWith('<![CDATA[', start)) {
    const end = src.indexOf(']]>', start + 9);
    if (end === -1) {
      throw new UploadValidationError('Invalid SVG: unclosed CDATA section', {
        code: 'INVALID_IMAGE',
      });
    }
    return end + 3;
  }

  // DOCTYPE / ENTITY / other <!...> declarations (supports nested [...] internal subset)
  let pos = start + 2;
  let bracketDepth = 0;
  let quote: string | null = null;
  while (pos < src.length) {
    const ch = src[pos];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[') {
      bracketDepth++;
    } else if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
    } else if (ch === '>' && bracketDepth === 0) {
      return pos + 1;
    }
    pos++;
  }

  throw new UploadValidationError('Invalid SVG: unclosed XML declaration', {
    code: 'INVALID_IMAGE',
  });
}

function skipProcessingInstruction(src: string, start: number): number {
  const end = src.indexOf('?>', start + 2);
  if (end === -1) {
    throw new UploadValidationError(
      'Invalid SVG: unclosed processing instruction',
      { code: 'INVALID_IMAGE' },
    );
  }
  return end + 2;
}

function parseAttributes(
  src: string,
  start: number,
): { attrs: SvgAttribute[]; selfClosing: boolean; next: number } {
  const attrs: SvgAttribute[] = [];
  let pos = start;

  while (pos < src.length) {
    pos = skipWhitespace(src, pos);
    if (pos >= src.length) {
      throw new UploadValidationError('Invalid SVG: unclosed XML tag', {
        code: 'INVALID_IMAGE',
      });
    }

    const ch = src[pos];
    if (ch === '>') {
      return { attrs, selfClosing: false, next: pos + 1 };
    }
    if (ch === '/' && src[pos + 1] === '>') {
      return { attrs, selfClosing: true, next: pos + 2 };
    }
    if (ch === '<') {
      throw new UploadValidationError(
        'Invalid SVG: unexpected "<" inside XML tag',
        { code: 'INVALID_IMAGE' },
      );
    }

    const { name, next } = readName(src, pos);
    pos = skipWhitespace(src, next);

    let value = '';
    if (pos < src.length && src[pos] === '=') {
      pos = skipWhitespace(src, pos + 1);
      if (pos >= src.length) {
        throw new UploadValidationError(
          'Invalid SVG: missing attribute value',
          { code: 'INVALID_IMAGE' },
        );
      }
      const quote = src[pos];
      if (quote === '"' || quote === "'") {
        const closeQuote = src.indexOf(quote, pos + 1);
        if (closeQuote === -1) {
          throw new UploadValidationError(
            'Invalid SVG: unclosed quoted attribute',
            { code: 'INVALID_IMAGE' },
          );
        }
        value = src.slice(pos + 1, closeQuote);
        pos = closeQuote + 1;
      } else {
        const valStart = pos;
        while (
          pos < src.length &&
          !isWhitespace(src[pos]) &&
          src[pos] !== '>' &&
          src[pos] !== '/' &&
          src[pos] !== '<'
        ) {
          pos++;
        }
        if (pos === valStart) {
          throw new UploadValidationError(
            'Invalid SVG: malformed unquoted attribute value',
            { code: 'INVALID_IMAGE' },
          );
        }
        value = src.slice(valStart, pos);
      }
    }

    attrs.push({ name, value });
  }

  throw new UploadValidationError('Invalid SVG: unclosed XML tag', {
    code: 'INVALID_IMAGE',
  });
}

/**
 * Zero-dependency strict XML/SVG tokenizer.
 * Strips comments, DOCTYPE/ENTITY declarations, CDATA, and processing instructions,
 * and rejects malformed XML tags or unclosed constructs.
 */
export function tokenizeSvg(input: string): SvgToken[] {
  const src = input.replace(/^\uFEFF/, '');
  const tokens: SvgToken[] = [];
  let pos = 0;

  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    if (lt === -1) {
      const text = src.slice(pos);
      if (text) tokens.push({ type: 'text', value: text });
      break;
    }

    if (lt > pos) {
      tokens.push({ type: 'text', value: src.slice(pos, lt) });
    }

    if (lt + 1 >= src.length) {
      throw new UploadValidationError('Invalid SVG: trailing "<" character', {
        code: 'INVALID_IMAGE',
      });
    }

    const nextChar = src[lt + 1];
    if (nextChar === '!') {
      pos = skipDeclaration(src, lt);
      continue;
    }
    if (nextChar === '?') {
      pos = skipProcessingInstruction(src, lt);
      continue;
    }
    if (nextChar === '/') {
      const nameStart = skipWhitespace(src, lt + 2);
      const { name, next } = readName(src, nameStart);
      const closePos = skipWhitespace(src, next);
      if (closePos >= src.length || src[closePos] !== '>') {
        throw new UploadValidationError(
          'Invalid SVG: malformed XML closing tag',
          { code: 'INVALID_IMAGE' },
        );
      }
      tokens.push({ type: 'close', name });
      pos = closePos + 1;
      continue;
    }

    const { name, next } = readName(src, lt + 1);
    const { attrs, selfClosing, next: afterTag } = parseAttributes(src, next);
    tokens.push({ type: 'open', name, attrs, selfClosing });
    pos = afterTag;
  }

  return tokens;
}
