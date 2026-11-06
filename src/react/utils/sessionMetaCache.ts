import type { ImageOutputFormat } from '../../types';

export interface SessionMetaLookup {
  url?: string | null;
  contentHash?: string | null;
}

export interface CachedBlurMeta {
  blurDataUrl?: string;
  blurColor?: string;
}

export interface UploadSessionCache {
  writeAltMetaFor: (info: SessionMetaLookup, alt: string) => void;
  readAltMetaFor: (info: SessionMetaLookup) => string | null;
  writeBlurMetaFor: (info: SessionMetaLookup, meta: CachedBlurMeta) => void;
  readBlurMetaFor: (info: SessionMetaLookup) => CachedBlurMeta | null;
}

const SIGNED_URL_QUERY_RE =
  /[?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Algorithm|X-Goog-Signature|Signature|AWSAccessKeyId|GoogleAccessId|token|sig|sv|se)=/i;

export function isSignedStorageUrl(url: string): boolean {
  return SIGNED_URL_QUERY_RE.test(url);
}

export function appendCacheBuster(
  url: string,
  options: { enabled?: boolean; token?: string | number } = {},
): string {
  if (!url || !options.enabled) return url;
  if (/^(?:blob:|data:)/i.test(url) || isSignedStorageUrl(url)) return url;
  if (/[?&](?:v|t)=/i.test(url)) return url;
  const buster = options.token ?? Date.now();
  return `${url}${url.includes('?') ? '&' : '?'}t=${buster}`;
}

export function readSessionJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeSessionJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

export function createUploadSessionCache(
  storagePrefix = 'iuk',
): UploadSessionCache {
  const altKey = (id: string) => `${storagePrefix}:alt-meta:${id}`;
  const blurKey = (id: string) => `${storagePrefix}:blur-meta:${id}`;

  const writeAltMetaFor = (info: SessionMetaLookup, alt: string): void => {
    if (!alt?.trim()) return;
    if (info.url) writeSessionJson(altKey(info.url), alt);
    if (info.contentHash) writeSessionJson(altKey(info.contentHash), alt);
  };

  const readAltMetaFor = (info: SessionMetaLookup): string | null => {
    if (info.contentHash) {
      const byHash = readSessionJson<string>(altKey(info.contentHash));
      if (byHash) return byHash;
    }
    if (info.url) {
      const byUrl = readSessionJson<string>(altKey(info.url));
      if (byUrl) return byUrl;
    }
    return null;
  };

  const writeBlurMetaFor = (
    info: SessionMetaLookup,
    meta: CachedBlurMeta,
  ): void => {
    if (info.url) writeSessionJson(blurKey(info.url), meta);
    if (info.contentHash) writeSessionJson(blurKey(info.contentHash), meta);
  };

  const readBlurMetaFor = (info: SessionMetaLookup): CachedBlurMeta | null => {
    if (info.contentHash) {
      const byHash = readSessionJson<CachedBlurMeta>(blurKey(info.contentHash));
      if (byHash?.blurDataUrl || byHash?.blurColor) return byHash;
    }
    if (info.url) {
      const byUrl = readSessionJson<CachedBlurMeta>(blurKey(info.url));
      if (byUrl?.blurDataUrl || byUrl?.blurColor) return byUrl;
    }
    return null;
  };

  return {
    writeAltMetaFor,
    readAltMetaFor,
    writeBlurMetaFor,
    readBlurMetaFor,
  };
}

const MIME_TO_EXT: Record<string, ImageOutputFormat | 'jpg'> = {
  'image/avif': 'avif',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
};

export async function downloadImageWithFallback(
  url: string,
  format?: ImageOutputFormat,
): Promise<void> {
  if (!url || typeof window === 'undefined') return;
  try {
    const fetchUrl = isSignedStorageUrl(url)
      ? url
      : appendCacheBuster(url, { enabled: true });
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Download failed with status ${res.status}`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    const ext: ImageOutputFormat | 'jpg' =
      format ?? MIME_TO_EXT[blob.type] ?? 'avif';

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `image-${Date.now()}.${ext}`;
    anchor.style.display = 'none';
    document.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Ignore revocation errors
      }
    }, 1000);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
