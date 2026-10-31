export const DEFAULT_CDN_PATTERNS: RegExp[] = [
  /^https?:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/,
  /^https?:\/\/[^/]+\.r2\.dev\/(.+)$/,
  /^https?:\/\/[^/]+\.amazonaws\.com\/(.+)$/,
  /^https?:\/\/[^/]+\.cloudflare\.com\/(.+)$/,
  /^https?:\/\/cdn\.[^/]+\/(.+)$/,
];

export interface NormalizePathOptions {
  cdnPatterns?: RegExp[];
  stripPrefixes?: string[];
}

export interface PathInfo {
  normalizedPath: string;
  folder?: string;
  filename?: string;
  extension?: string;
  isExternal: boolean;
  originalPath: string;
}

/**
 * Project-agnostic image URL / path normalizer.
 * Strips query parameters, leading `/public/`, relative `./`, and common CDN prefixes
 * so manifest keys match consistently across local and CDN environments.
 */
export function normalizeImagePath(
  imageSrc: string,
  options: NormalizePathOptions = {},
): PathInfo {
  const originalPath = imageSrc;
  let normalizedPath = imageSrc;
  let isExternal = false;

  try {
    if (imageSrc.startsWith('data:') || imageSrc.startsWith('blob:')) {
      return {
        normalizedPath: imageSrc,
        isExternal: false,
        originalPath,
      };
    }

    const patterns = options.cdnPatterns || DEFAULT_CDN_PATTERNS;

    if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
      const url = new URL(imageSrc);
      isExternal = true;
      const cleanUrlNoQuery = `${url.origin}${url.pathname}`;

      for (const pattern of patterns) {
        const match = cleanUrlNoQuery.match(pattern);
        if (match) {
          const pathPart = match[match.length - 1];
          normalizedPath = '/' + pathPart.replace(/^\/+/, '');
          break;
        }
      }

      if (normalizedPath === imageSrc) {
        normalizedPath = url.pathname;
      }
    } else {
      normalizedPath = normalizedPath.split('?')[0].split('#')[0];
    }

    normalizedPath = normalizedPath.replace(/\\/g, '/').replace(/^\.\.?\//g, '');

    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }

    const prefixesToStrip = options.stripPrefixes || ['/public/'];
    for (const prefix of prefixesToStrip) {
      if (normalizedPath.startsWith(prefix)) {
        normalizedPath = '/' + normalizedPath.slice(prefix.length).replace(/^\/+/, '');
      }
    }

    const segments = normalizedPath.split('/').filter(Boolean);
    const filename = segments[segments.length - 1];
    const folder =
      segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
    const dotIdx = filename ? filename.lastIndexOf('.') : -1;
    const extension =
      filename && dotIdx > 0 ? filename.slice(dotIdx + 1).toLowerCase() : undefined;

    return {
      normalizedPath,
      folder,
      filename,
      extension,
      isExternal,
      originalPath,
    };
  } catch {
    return {
      normalizedPath: imageSrc,
      isExternal: false,
      originalPath,
    };
  }
}
