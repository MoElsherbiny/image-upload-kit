import type {
  CropStrategy,
  ExplicitOutputFormat,
  ImageAspectRatio,
  ImageDimensions,
  ImageUploadOptions,
} from '../../types';
import { resolveAspectRatio } from '../../types/aspectRatio';
import {
  kitErrorResponse,
  normalizeOverrides,
  resolveClientFolder,
  sanitizeFolderSegment,
  sanitizeMetadataRecord,
} from './guards';
import type {
  AuthorizeContext,
  UploadHttpHandlerOptions,
} from './options';

const ALLOWED_OUTPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);
const ALLOWED_CROP_STRATEGIES = new Set<CropStrategy>(['attention', 'entropy', 'center']);

function parseJsonRecord(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    return sanitizeMetadataRecord(JSON.parse(raw));
  } catch {
    // Ignore malformed metadata JSON
    return undefined;
  }
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
    return { errorResponse: kitErrorResponse('No file provided', 'INVALID_IMAGE', 400, false) };
  }

  const file = formData.get('file') as File | null;
  if (
    !file ||
    typeof file === 'string' ||
    (typeof file.size === 'number' && file.size === 0 && !file.name)
  ) {
    return { errorResponse: kitErrorResponse('No file provided', 'INVALID_IMAGE', 400, false) };
  }
  if (typeof file.size === 'number' && file.size === 0) {
    return { errorResponse: kitErrorResponse('File is empty', 'INVALID_IMAGE', 400, false) };
  }

  const { uploader, allowedPresets, allowClientBucketOverride = false, allowedBuckets } = options;
  const overrides = normalizeOverrides(options.allowClientOverrides);

  const preset = (formData.get('preset') as TPreset | null) || undefined;
  if (preset) {
    if (allowedPresets && allowedPresets.length > 0 && !allowedPresets.includes(preset)) {
      return {
        errorResponse: kitErrorResponse(
          `Invalid preset "${preset}". Allowed presets: ${allowedPresets.join(', ')}`,
          'INVALID_IMAGE',
          400,
          false,
        ),
      };
    }
    if (typeof uploader.resolvePreset === 'function' && !uploader.resolvePreset(preset)) {
      return {
        errorResponse: kitErrorResponse(`Invalid preset "${preset}".`, 'INVALID_IMAGE', 400, false),
      };
    }
  }

  const presetConfig =
    preset && typeof uploader.resolvePreset === 'function'
      ? uploader.resolvePreset(preset)
      : undefined;

  const rawBucket = (formData.get('bucket') as string | null) || undefined;
  if (rawBucket && allowedBuckets && !allowedBuckets.includes(rawBucket)) {
    return {
      errorResponse: kitErrorResponse(`Bucket "${rawBucket}" is not allowed`, 'FORBIDDEN', 403, false),
    };
  }
  const bucket = allowClientBucketOverride ? rawBucket : undefined;

  const rawFolder = (formData.get('folder') as string | null) || undefined;
  const resolvedFolder = resolveClientFolder(rawFolder, overrides, authCtx);
  if (resolvedFolder.errorResponse) return { errorResponse: resolvedFolder.errorResponse };
  const folder = resolvedFolder.folder;

  const rawFilename = (formData.get('customFilename') as string | null) || undefined;
  const customFilename = overrides?.filename ? rawFilename : undefined;

  const outputFormatRaw = formData.get('outputFormat') as string | null;
  if (outputFormatRaw && !ALLOWED_OUTPUT_FORMATS.has(outputFormatRaw)) {
    return {
      errorResponse: kitErrorResponse(
        `Invalid output format "${outputFormatRaw}". Allowed formats: jpeg, png, webp, avif`,
        'UNSUPPORTED_FORMAT',
        400,
        false,
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
        errorResponse: kitErrorResponse(
          `Invalid quality "${qualityRaw}". Must be an integer between 1 and 100.`,
          'INVALID_IMAGE',
          400,
          false,
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
      return {
        errorResponse: kitErrorResponse('Invalid maxWidth or maxHeight dimensions', 'INVALID_IMAGE', 400, false),
      };
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
        return {
          errorResponse: kitErrorResponse(`Invalid aspectRatio "${aspectRatioRaw}"`, 'INVALID_IMAGE', 400, false),
        };
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
        errorResponse: kitErrorResponse(
          `Invalid crop "${cropRaw}". Allowed values: attention, entropy, center`,
          'INVALID_IMAGE',
          400,
          false,
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
