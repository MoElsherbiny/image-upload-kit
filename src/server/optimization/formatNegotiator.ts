import type { ExplicitOutputFormat } from '../../types';

export interface NegotiateOutputFormatOptions {
  /** Explicit output format override; always takes precedence when provided. */
  outputFormat?: ExplicitOutputFormat;
  /** Candidate formats ordered by server preference (defaults to `['avif', 'webp', 'jpeg', 'png']`). */
  allowedFormats?: ExplicitOutputFormat[];
  /** Fallback format when `Accept` header is absent or has no match. */
  fallback?: ExplicitOutputFormat;
  /** Hint that source has transparency; shifts default fallback from `'jpeg'` to `'png'`. */
  hasAlpha?: boolean;
}

const DEFAULT_ALLOWED_FORMATS: ExplicitOutputFormat[] = [
  'avif',
  'webp',
  'jpeg',
  'png',
];

const MIME_TO_FORMAT: Record<string, ExplicitOutputFormat> = {
  'image/avif': 'avif',
  'image/webp': 'webp',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
};

interface ParsedAcceptEntry {
  mime: string;
  q: number;
  specificity: number;
}

function parseAcceptHeader(header: string): ParsedAcceptEntry[] {
  const entries: ParsedAcceptEntry[] = [];
  for (const rawPart of header.split(',')) {
    const trimmed = rawPart.trim();
    if (!trimmed) continue;
    const [rawMime, ...params] = trimmed.split(';').map((s) => s.trim().toLowerCase());
    if (!rawMime) continue;

    let q = 1;
    for (const param of params) {
      if (param.startsWith('q=')) {
        const parsed = Number.parseFloat(param.slice(2));
        if (Number.isFinite(parsed)) {
          q = Math.max(0, Math.min(1, parsed));
        }
      }
    }

    const specificity = rawMime === '*/*' ? 0 : rawMime.endsWith('/*') ? 1 : 2;
    entries.push({ mime: rawMime, q, specificity });
  }
  return entries;
}

function scoreFormatForAccept(
  format: ExplicitOutputFormat,
  entries: ParsedAcceptEntry[],
): { q: number; specificity: number } | null {
  let best: { q: number; specificity: number } | null = null;
  for (const entry of entries) {
    const exactMatch = MIME_TO_FORMAT[entry.mime] === format;
    const wildcardMatch = entry.mime === 'image/*' || entry.mime === '*/*';
    if (!exactMatch && !wildcardMatch) continue;
    if (
      !best ||
      entry.specificity > best.specificity ||
      (entry.specificity === best.specificity && entry.q > best.q)
    ) {
      best = { q: entry.q, specificity: entry.specificity };
    }
  }
  return best;
}

/**
 * Negotiates the best image output format from an HTTP `Accept` header while
 * honoring explicit `outputFormat` overrides and server format preferences.
 */
export function negotiateOutputFormat(
  acceptHeader: string | null | undefined,
  options: NegotiateOutputFormatOptions = {},
): ExplicitOutputFormat {
  if (options.outputFormat) {
    return options.outputFormat;
  }

  const allowed =
    options.allowedFormats && options.allowedFormats.length > 0
      ? options.allowedFormats
      : DEFAULT_ALLOWED_FORMATS;
  const fallback: ExplicitOutputFormat =
    options.fallback ?? (options.hasAlpha ? 'png' : 'jpeg');

  if (!acceptHeader || !acceptHeader.trim()) {
    return allowed.includes(fallback) ? fallback : allowed[0];
  }

  const entries = parseAcceptHeader(acceptHeader);
  if (entries.length === 0) {
    return allowed.includes(fallback) ? fallback : allowed[0];
  }

  let winner: { format: ExplicitOutputFormat; q: number; specificity: number; rank: number } | null =
    null;

  for (let i = 0; i < allowed.length; i++) {
    const format = allowed[i];
    const match = scoreFormatForAccept(format, entries);
    if (!match || match.q <= 0) continue;

    if (
      !winner ||
      match.q > winner.q ||
      (match.q === winner.q && match.specificity > winner.specificity) ||
      (match.q === winner.q && match.specificity === winner.specificity && i < winner.rank)
    ) {
      winner = { format, q: match.q, specificity: match.specificity, rank: i };
    }
  }

  return winner ? winner.format : allowed.includes(fallback) ? fallback : allowed[0];
}
