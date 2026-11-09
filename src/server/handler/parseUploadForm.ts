import type {
  CropStrategy,
  ExplicitOutputFormat,
  ImageAspectRatio,
  ImageDimensions,
  ImageUploadOptions,
} from '../../types';
import { resolveAspectRatio } from '../../types/aspectRatio';
import { normalizeOverrides, sanitizeFolderSegment } from './guards';
import type {
  AuthorizeContext,
  UploadHttpHandlerOptions,
} from './options';
import { jsonResponse } from './responses';

const ALLOWED_OUTPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);
const ALLOWED_CROP_STRATEGIES = new Set<CropStrategy>(['attention', 'entropy', 'center']);

function parseJsonRecord(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== undefined && v !== null) clean[k] = String(v);
      }
      return Object.keys(clean).length > 0 ? clean : undefined;
    }
  } catch {
    // Ignore malformed metadata JSON
  }
  return undefined;
}

export function peekUploadAuthContext<TPreset extends string>(
  formData: FormData | undefined,
  request: Request,
  options: UploadHttpHandlerOptions<TPreset>,
): AuthorizeContext {
  const overrides = normalizeOverrides(options.allowClientOverrides);
  const preset = (formData?.get('preset') as string | null) || undefined;
  const rawBucket = (formData?.get('bucket') as string | null) || undefined;
  const rawFolder = (formData?.get('folder') as string | null) || undefined;
  const presetConfig =
    preset && typeof options.uploader.resolvePreset === 'function'
      ? options.uploader.resolvePreset(preset)
      : undefined;

  const bucket = options.allowClientBucketOverride
    ? rawBucket || presetConfig?.bucket || options.uploader.defaultBucket
    : presetConfig?.bucket || options.uploader.defaultBucket;

  const sanitizedRawFolder = rawFolder ? sanitizeFolderSegment(rawFolder) : undefined;
  const folder = overrides?.folder
    ? sanitizedRawFolder || presetConfig?.folder
    : presetConfig?.folder;

  return {
    action: 'upload',
    request,
    ...(folder ? { path: folder } : {}),
    ...(bucket ? { bucket } : {}),
    ...(preset ? { preset } : {}),
  };
}

export interface ParsedUploadFormResult<TPreset extends string> {
  file?: File;
  uploadOptions?: ImageUploadOptions<TPreset>;
  errorResponse?: Response;
}

export function parseUploadForm<TPreset extends string>(
  formData: FormData | undefined,
  authCtx: AuthorizeContext,
  options: UploadHttpHandlerOptions<TPreset>,
): ParsedUploadFormResult<TPreset> {
  if (!formData) {
    return { errorResponse: jsonResponse({ error: 'No file provided' }, 400) };
  }

  const file = formData.get('file') as File | null;
  if (
    !file ||
    typeof file === 'string' ||
    (typeof file.size === 'number' && file.size === 0 && !file.name)
  ) {
    return { errorResponse: jsonResponse({ error: 'No file provided' }, 400) };
  }
  if (typeof file.size === 'number' && file.size === 0) {
    return { errorResponse: jsonResponse({ error: 'File is empty' }, 400) };
  }

  const { uploader, allowedPresets, allowClientBucketOverride = false, allowedBuckets } = options;
  const overrides = normalizeOverrides(options.allowClientOverrides);

  const preset = (formData.get('preset') as TPreset | null) || undefined;
  if (preset) {
    if (allowedPresets && allowedPresets.length > 0 && !allowedPresets.includes(preset)) {
      return {
        errorResponse: jsonResponse(
          { error: `Invalid preset "${preset}". Allowed presets: ${allowedPresets.join(', ')}` },
          400,
        ),
      };
    }
    if (typeof uploader.resolvePreset === 'function' && !uploader.resolvePreset(preset)) {
      return { errorResponse: jsonResponse({ error: `Invalid preset "${preset}".` }, 400) };
    }
  }

  const presetConfig =
    preset && typeof uploader.resolvePreset === 'function'
      ? uploader.resolvePreset(preset)
      : undefined;

  const rawBucket = (formData.get('bucket') as string | null) || undefined;
  if (rawBucket && allowedBuckets && !allowedBuckets.includes(rawBucket)) {
    return { errorResponse: jsonResponse({ error: `Bucket "${rawBucket}" is not allowed` }, 403) };
  }
  const bucket = allowClientBucketOverride ? rawBucket : undefined;

  let folder: string | undefined;
  const rawFolder = (formData.get('folder') as string | null) || undefined;
  if (rawFolder !== undefined) {
    if (overrides?.folder === true) {
      folder = sanitizeFolderSegment(rawFolder) || undefined;
    } else if (typeof overrides?.folder === 'function') {
      const scoped = overrides.folder(rawFolder, authCtx);
      if (scoped === null) {
        return { errorResponse: jsonResponse({ error: 'Invalid or disallowed folder' }, 400) };
      }
      folder = scoped ? sanitizeFolderSegment(scoped) : undefined;
    }
  }

  const rawFilename = (formData.get('customFilename') as string | null) || undefined;
  const customFilename = overrides?.filename ? rawFilename : undefined;

  const outputFormatRaw = formData.get('outputFormat') as string | null;
  if (outputFormatRaw && !ALLOWED_OUTPUT_FORMATS.has(outputFormatRaw)) {
    return {
      errorResponse: jsonResponse(
        { error: `Invalid output format "${outputFormatRaw}". Allowed formats: jpeg, png, webp, avif` },
        400,
      ),
    };
  }
  const outputFormat =
    overrides?.format && outputFormatRaw
      ? (outputFormatRaw as ExplicitOutputFormat)
      : undefined;

  const qualityRaw = formData.get('quality') as string | null;
  let quality: number | undefined;
  if (qualityRaw !== null && qualityRaw.trim() !== '') {
    const parsedQuality = Number(qualityRaw);
    if (!Number.isFinite(parsedQuality) || !Number.isInteger(parsedQuality) || parsedQuality < 1 || parsedQuality > 100) {
      return {
        errorResponse: jsonResponse(
          { error: `Invalid quality "${qualityRaw}". Must be an integer between 1 and 100.` },
          400,
        ),
      };
    }
    if (overrides?.quality) {
      quality = presetConfig?.quality ? Math.min(parsedQuality, presetConfig.quality) : parsedQuality;
    }
  }

  const maxWidthRaw = formData.get('maxWidth') as string | null;
  const maxHeightRaw = formData.get('maxHeight') as string | null;
  let maxDimensions: ImageDimensions | undefined;
  if ((maxWidthRaw !== null && maxWidthRaw.trim() !== '') || (maxHeightRaw !== null && maxHeightRaw.trim() !== '')) {
    const w = Number(maxWidthRaw);
    const h = Number(maxHeightRaw);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
      return { errorResponse: jsonResponse({ error: 'Invalid maxWidth or maxHeight dimensions' }, 400) };
    }
    if (overrides?.dimensions) {
      const cap = presetConfig?.maxDimensions;
      maxDimensions = cap
        ? { width: Math.min(Math.floor(w), cap.width), height: Math.min(Math.floor(h), cap.height) }
        : { width: Math.floor(w), height: Math.floor(h) };
    }
  }

  const aspectRatioRaw = formData.get('aspectRatio') as string | null;
  let aspectRatio: Exclude<ImageAspectRatio, 'auto'> | undefined;
  if (aspectRatioRaw !== null && aspectRatioRaw.trim() !== '') {
    const trimmedRatio = aspectRatioRaw.trim();
    if (trimmedRatio !== 'auto') {
      const numericRatio = resolveAspectRatio(trimmedRatio);
      if (numericRatio === undefined) {
        return { errorResponse: jsonResponse({ error: `Invalid aspectRatio "${aspectRatioRaw}"` }, 400) };
      }
      if (overrides?.aspectRatio) {
        aspectRatio = (
          !trimmedRatio.includes(':') && !trimmedRatio.includes('/') ? numericRatio : trimmedRatio
        ) as Exclude<ImageAspectRatio, 'auto'>;
      }
    }
  }

  const cropRaw = formData.get('crop') as string | null;
  let crop: CropStrategy | undefined;
  if (cropRaw !== null && cropRaw.trim() !== '') {
    const trimmedCrop = cropRaw.trim() as CropStrategy;
    if (!ALLOWED_CROP_STRATEGIES.has(trimmedCrop)) {
      return {
        errorResponse: jsonResponse(
          { error: `Invalid crop "${cropRaw}". Allowed values: attention, entropy, center` },
          400,
        ),
      };
    }
    if (overrides?.aspectRatio || overrides?.crop) crop = trimmedCrop;
  }

  const altText = (formData.get('altText') as string | null) || undefined;
  const metadata = parseJsonRecord(formData.get('metadata') as string | null);

  return {
    file,
    uploadOptions: {
      preset, folder, bucket, altText, customFilename,
      ...(customFilename ? { isClientFilename: true } : {}),
      outputFormat, quality, maxDimensions,
      ...(aspectRatio !== undefined ? { aspectRatio } : {}),
      ...(crop !== undefined ? { crop } : {}),
      metadata, signal: authCtx.request.signal,
    },
  };
}
