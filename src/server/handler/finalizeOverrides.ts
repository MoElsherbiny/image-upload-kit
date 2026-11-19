import type {
  CropStrategy,
  ExplicitOutputFormat,
  ImageAspectRatio,
  ImageDimensions,
  UploadPresetConfig,
} from '../../types';
import { resolveAspectRatio } from '../../types/aspectRatio';
import { kitErrorResponse, sanitizeMetadataRecord } from './guards';
import type { AllowClientOverrides } from './options';

const ALLOWED_OUTPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);
const ALLOWED_CROP_STRATEGIES = new Set<CropStrategy>(['attention', 'entropy', 'center']);

export interface ParsedFinalizeOverrides {
  altText?: string;
  customFilename?: string;
  outputFormat?: ExplicitOutputFormat;
  quality?: number;
  maxDimensions?: ImageDimensions;
  aspectRatio?: Exclude<ImageAspectRatio, 'auto'>;
  crop?: CropStrategy;
  metadata?: Record<string, string>;
  errorResponse?: Response;
}

export function parseFinalizeOverrides(
  body: Record<string, unknown>,
  overrides: AllowClientOverrides | undefined,
  presetConfig: UploadPresetConfig | undefined,
): ParsedFinalizeOverrides {
  const altText = typeof body.altText === 'string' ? body.altText : undefined;
  const customFilename =
    overrides?.filename && typeof body.customFilename === 'string' && body.customFilename
      ? body.customFilename
      : undefined;

  let outputFormat: ExplicitOutputFormat | undefined;
  if (typeof body.outputFormat === 'string' && body.outputFormat) {
    if (!ALLOWED_OUTPUT_FORMATS.has(body.outputFormat)) {
      return {
        errorResponse: kitErrorResponse(
          `Invalid output format "${body.outputFormat}". Allowed formats: jpeg, png, webp, avif`,
          'UNSUPPORTED_FORMAT',
          400,
          false,
        ),
      };
    }
    if (overrides?.format) outputFormat = body.outputFormat as ExplicitOutputFormat;
  }

  let quality: number | undefined;
  if (body.quality !== undefined && body.quality !== null) {
    const q = Number(body.quality);
    if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1 || q > 100) {
      return {
        errorResponse: kitErrorResponse(
          `Invalid quality "${body.quality}". Must be an integer between 1 and 100.`,
          'INVALID_IMAGE',
          400,
          false,
        ),
      };
    }
    if (overrides?.quality) {
      quality = presetConfig?.quality ? Math.min(q, presetConfig.quality) : q;
    }
  }

  let maxDimensions: ImageDimensions | undefined;
  if (body.maxDimensions && typeof body.maxDimensions === 'object') {
    const dims = body.maxDimensions as { width?: unknown; height?: unknown };
    const w = Number(dims.width);
    const h = Number(dims.height);
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

  let aspectRatio: Exclude<ImageAspectRatio, 'auto'> | undefined;
  if (body.aspectRatio !== undefined && body.aspectRatio !== null && body.aspectRatio !== 'auto') {
    const numericRatio = resolveAspectRatio(body.aspectRatio as ImageAspectRatio);
    if (numericRatio === undefined) {
      return {
        errorResponse: kitErrorResponse(`Invalid aspectRatio "${String(body.aspectRatio)}"`, 'INVALID_IMAGE', 400, false),
      };
    }
    if (overrides?.aspectRatio) aspectRatio = body.aspectRatio as Exclude<ImageAspectRatio, 'auto'>;
  }

  let crop: CropStrategy | undefined;
  if (typeof body.crop === 'string' && body.crop) {
    const trimmedCrop = body.crop.trim() as CropStrategy;
    if (!ALLOWED_CROP_STRATEGIES.has(trimmedCrop)) {
      return {
        errorResponse: kitErrorResponse(
          `Invalid crop "${body.crop}". Allowed values: attention, entropy, center`,
          'INVALID_IMAGE',
          400,
          false,
        ),
      };
    }
    if (overrides?.aspectRatio || overrides?.crop) crop = trimmedCrop;
  }

  return {
    altText,
    customFilename,
    outputFormat,
    quality,
    maxDimensions,
    aspectRatio,
    crop,
    metadata: sanitizeMetadataRecord(body.metadata),
  };
}
