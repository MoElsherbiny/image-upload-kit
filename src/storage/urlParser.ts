export interface PublicStorageInfo {
  bucket: string;
  path: string;
  filename: string;
  extension: string | null;
}

export const DEFAULT_PUBLIC_STORAGE_PREFIX = '/storage/v1/object/public/';

export function parsePublicStorageUrl(
  url?: string | null,
  publicPrefix: string = DEFAULT_PUBLIC_STORAGE_PREFIX,
): PublicStorageInfo | null {
  if (!url) return null;

  try {
    const parsed = new URL(url, 'http://localhost');
    const pathname = parsed.pathname;
    const prefixIndex = pathname.indexOf(publicPrefix);

    if (prefixIndex === -1) {
      return null;
    }

    const relativePath = pathname
      .slice(prefixIndex + publicPrefix.length)
      .replace(/^\/+/, '');

    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    const [bucket, ...pathParts] = segments;
    const filePath = pathParts.join('/');
    const filename = pathParts[pathParts.length - 1];
    const lastDotIndex = filename.lastIndexOf('.');
    const extension = lastDotIndex >= 0 ? filename.slice(lastDotIndex) : null;

    return {
      bucket,
      path: filePath,
      filename,
      extension,
    };
  } catch {
    return null;
  }
}
