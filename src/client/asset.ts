import type { NativeUploadAsset, UploadableAsset } from './types';

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Type guard for React Native `{ uri, name?, type?, size? }` upload assets.
 */
export function isNativeAsset(input: unknown): input is NativeUploadAsset {
  if (!input || typeof input !== 'object') return false;
  if (typeof Blob !== 'undefined' && input instanceof Blob) return false;
  const candidate = input as { uri?: unknown };
  return typeof candidate.uri === 'string' && candidate.uri.trim().length > 0;
}

export const isReactNativeAsset = isNativeAsset;

function extractExtensionFromNameOrUri(raw: string): string | undefined {
  const clean = raw.split(/[?#]/)[0] || '';
  const match = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Resolves the MIME type of a Web `File`/`Blob` or `NativeUploadAsset`.
 */
export function getAssetMimeType(asset: UploadableAsset): string {
  if (isNativeAsset(asset)) {
    if (asset.type && asset.type.includes('/')) {
      return asset.type.toLowerCase();
    }
    const ext =
      (asset.name && extractExtensionFromNameOrUri(asset.name)) ||
      extractExtensionFromNameOrUri(asset.uri);
    if (ext && EXT_TO_MIME[ext]) {
      return EXT_TO_MIME[ext];
    }
    return 'image/jpeg';
  }
  return asset.type ? asset.type.toLowerCase() : 'application/octet-stream';
}

/**
 * Resolves a safe filename for a Web `File`/`Blob` or `NativeUploadAsset`.
 * Synthesizes `upload.<ext>` when Android `content://` or `Blob` assets have no filename.
 */
export function getAssetName(
  asset: UploadableAsset,
  fallbackIndex?: number,
): string {
  const mime = getAssetMimeType(asset);
  const defaultExt = MIME_TO_EXT[mime] || 'jpg';
  const suffix = fallbackIndex !== undefined ? `-${fallbackIndex + 1}` : '';

  if (isNativeAsset(asset)) {
    if (asset.name && asset.name.trim()) {
      const trimmed = asset.name.trim();
      return trimmed.includes('.') ? trimmed : `${trimmed}.${defaultExt}`;
    }
    const uriPath = asset.uri.split(/[?#]/)[0] || '';
    const lastSegment = uriPath.split('/').pop() || '';
    if (lastSegment && /\.[a-zA-Z0-9]{2,5}$/.test(lastSegment)) {
      return lastSegment;
    }
    return `upload${suffix}.${defaultExt}`;
  }

  if ('name' in asset && typeof asset.name === 'string' && asset.name.trim()) {
    return asset.name.trim();
  }
  return `upload${suffix}.${defaultExt}`;
}

/**
 * Resolves the byte size of an `UploadableAsset`, or `undefined` if unknown.
 */
export function getAssetSize(asset: UploadableAsset): number | undefined {
  if (isNativeAsset(asset)) {
    return typeof asset.size === 'number' && asset.size >= 0
      ? asset.size
      : undefined;
  }
  return typeof asset.size === 'number' ? asset.size : undefined;
}

/**
 * Returns a direct preview URI for `NativeUploadAsset` (`asset.uri`), or `undefined` for Web `File`/`Blob`.
 */
export function getAssetPreviewUri(asset: UploadableAsset): string | undefined {
  return isNativeAsset(asset) ? asset.uri : undefined;
}

/**
 * Returns `true` if the asset is an untranscoded Apple HEIC/HEIF container.
 */
export function isHeicAsset(asset: UploadableAsset): boolean {
  const mime = getAssetMimeType(asset);
  if (mime === 'image/heic' || mime === 'image/heif') return true;
  const name = getAssetName(asset).toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
}

/**
 * Appends either a Web `File`/`Blob` or a React Native `{ uri, name, type }` descriptor
 * onto a `FormData` instance.
 */
export function appendAssetToFormData(
  formData: FormData,
  fieldName: string,
  asset: UploadableAsset,
): void {
  if (isNativeAsset(asset)) {
    const rnPayload = {
      uri: asset.uri,
      name: getAssetName(asset),
      type: getAssetMimeType(asset),
    };
    formData.append(fieldName, rnPayload as unknown as Blob);
    return;
  }
  if ('name' in asset && typeof asset.name === 'string' && asset.name) {
    formData.append(fieldName, asset);
  } else {
    formData.append(fieldName, asset, getAssetName(asset));
  }
}
