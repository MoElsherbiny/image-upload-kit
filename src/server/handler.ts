import type { ExplicitOutputFormat, ImageDimensions } from '../types';
import type { ImageUploader } from './uploadService';

export interface UploadHttpHandlerOptions<TPreset extends string = string> {
  uploader: ImageUploader<TPreset>;
  /**
   * Optional authorization check. Return `false` or throw to reject with 401.
   */
  authorize?: (request: Request) => boolean | Promise<boolean>;
  /**
   * Optional whitelist of allowed preset names.
   */
  allowedPresets?: string[];
  /**
   * Allow clients to override `bucket` via FormData. Defaults to `false` for security.
   */
  allowClientBucketOverride?: boolean;
}

export class UploadValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

const VALIDATION_ERROR_SUBSTRINGS = [
  'exceeds maximum',
  'file size',
  'too large',
  'is not allowed',
  'not allowed',
  'unsupported image format',
  'unsupported format',
  'invalid format',
  'invalid image',
  'not a valid image',
  'file type',
  'invalid preset',
  'no file provided',
  'file is empty',
];

export function isClientValidationError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof UploadValidationError) return true;
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 400
  ) {
    return true;
  }
  if (
    error instanceof Error &&
    (error.name === 'UploadValidationError' ||
      error.name === 'ValidationError')
  ) {
    return true;
  }

  const msg =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return VALIDATION_ERROR_SUBSTRINGS.some((sub) => msg.includes(sub));
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseJsonRecord(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== undefined && v !== null) {
          clean[k] = String(v);
        }
      }
      return Object.keys(clean).length > 0 ? clean : undefined;
    }
  } catch {
    // Ignore malformed metadata JSON
  }
  return undefined;
}

/**
 * Standard Web Fetch (`Request` -> `Response`) upload & delete route handlers.
 * Works across Next.js App Router, Remix, React Router, SvelteKit, Astro, Hono, and Node Fetch servers.
 */
export function createUploadHttpHandler<TPreset extends string = string>(
  options: UploadHttpHandlerOptions<TPreset>,
) {
  const {
    uploader,
    authorize,
    allowedPresets,
    allowClientBucketOverride = false,
  } = options;

  async function POST(request: Request): Promise<Response> {
    try {
      if (authorize) {
        const allowed = await authorize(request);
        if (!allowed) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
      }

      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (
        !file ||
        typeof file === 'string' ||
        (typeof file.size === 'number' && file.size === 0 && !file.name)
      ) {
        return jsonResponse({ error: 'No file provided' }, 400);
      }
      if (typeof file.size === 'number' && file.size === 0) {
        return jsonResponse({ error: 'File is empty' }, 400);
      }

      const preset = (formData.get('preset') as TPreset | null) || undefined;
      if (preset) {
        if (
          allowedPresets &&
          allowedPresets.length > 0 &&
          !allowedPresets.includes(preset)
        ) {
          return jsonResponse(
            {
              error: `Invalid preset "${preset}". Allowed presets: ${allowedPresets.join(', ')}`,
            },
            400,
          );
        }
        if (
          typeof uploader.resolvePreset === 'function' &&
          !uploader.resolvePreset(preset)
        ) {
          return jsonResponse(
            {
              error: `Invalid preset "${preset}".`,
            },
            400,
          );
        }
      }

      const folder = (formData.get('folder') as string | null) || undefined;
      const bucket = allowClientBucketOverride
        ? (formData.get('bucket') as string | null) || undefined
        : undefined;
      const altText = (formData.get('altText') as string | null) || undefined;
      const customFilename =
        (formData.get('customFilename') as string | null) || undefined;

      const outputFormatRaw = formData.get('outputFormat') as string | null;
      if (
        outputFormatRaw &&
        !['jpeg', 'png', 'webp', 'avif'].includes(outputFormatRaw)
      ) {
        return jsonResponse(
          {
            error: `Invalid output format "${outputFormatRaw}". Allowed formats: jpeg, png, webp, avif`,
          },
          400,
        );
      }
      const outputFormat =
        (outputFormatRaw as ExplicitOutputFormat) || undefined;

      const qualityRaw = formData.get('quality') as string | null;
      const quality =
        qualityRaw !== null
          ? Math.max(1, Math.min(100, parseInt(qualityRaw, 10) || 85))
          : undefined;

      const maxWidthRaw = formData.get('maxWidth') as string | null;
      const maxHeightRaw = formData.get('maxHeight') as string | null;
      let maxDimensions: ImageDimensions | undefined;
      if (maxWidthRaw && maxHeightRaw) {
        const w = parseInt(maxWidthRaw, 10);
        const h = parseInt(maxHeightRaw, 10);
        if (w > 0 && h > 0) {
          maxDimensions = { width: w, height: h };
        }
      }

      const metadata = parseJsonRecord(
        formData.get('metadata') as string | null,
      );

      const result = await uploader.uploadImage(file, {
        preset,
        folder,
        bucket,
        altText,
        customFilename,
        outputFormat,
        quality,
        maxDimensions,
        metadata,
      });

      return jsonResponse(result, 200);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Internal server error';
      const status = isClientValidationError(error) ? 400 : 500;
      return jsonResponse({ error: errorMessage }, status);
    }
  }

  async function DELETE(request: Request): Promise<Response> {
    try {
      if (authorize) {
        const allowed = await authorize(request);
        if (!allowed) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }
      }

      const { searchParams } = new URL(request.url);
      const url = searchParams.get('url');
      if (url) {
        const deleted = await uploader.deleteByUrl(url);
        return jsonResponse({ success: deleted }, deleted ? 200 : 400);
      }

      const storagePath = searchParams.get('path');
      const bucket = allowClientBucketOverride
        ? searchParams.get('bucket') || undefined
        : undefined;

      if (!storagePath) {
        return jsonResponse(
          { error: 'Missing required "path" or "url" query parameter' },
          400,
        );
      }

      await uploader.deleteImage(storagePath, bucket);
      return jsonResponse({ success: true }, 200);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Internal server error';
      return jsonResponse({ error: errorMessage }, 500);
    }
  }

  return { POST, DELETE };
}
