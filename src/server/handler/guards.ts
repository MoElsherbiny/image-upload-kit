import type {
  AllowClientOverrides,
  AuthorizeContext,
  UploadHttpHandlerOptions,
} from './options';

export function normalizeOverrides(
  overrides?: AllowClientOverrides | boolean,
): AllowClientOverrides | undefined {
  if (overrides === true) {
    return {
      filename: true,
      folder: true,
      dimensions: true,
      format: true,
      quality: true,
      aspectRatio: true,
      crop: true,
    };
  }
  return overrides || undefined;
}

export function sanitizeFolderSegment(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._-]/g, '-'))
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}
import { jsonResponse } from './responses';

const DEFAULT_FALLBACK_MAX_MB = 25;
const MIN_DEFAULT_BODY_BYTES = 1024 * 1024; // 1 MB floor when maxBodyBytes is not explicitly set

export function resolveMaxBodyBytes<TPreset extends string>(
  options: UploadHttpHandlerOptions<TPreset>,
): number {
  if (
    typeof options.maxBodyBytes === 'number' &&
    Number.isFinite(options.maxBodyBytes) &&
    options.maxBodyBytes > 0
  ) {
    return Math.floor(options.maxBodyBytes);
  }

  const uploaderMaxMB =
    typeof options.uploader.getMaxSizeMB === 'function'
      ? options.uploader.getMaxSizeMB(options.allowedPresets)
      : DEFAULT_FALLBACK_MAX_MB;

  const computed = Math.ceil(1.25 * uploaderMaxMB * 1024 * 1024);
  return Math.max(MIN_DEFAULT_BODY_BYTES, computed);
}

function extractRequestOrigin(request: Request): string | null {
  const originHeader = request.headers.get('origin');
  if (originHeader && originHeader !== 'null') {
    return originHeader.trim();
  }

  const refererHeader = request.headers.get('referer');
  if (refererHeader) {
    try {
      return new URL(refererHeader).origin;
    } catch {
      return null;
    }
  }

  return null;
}

export function checkAllowedOrigin(
  request: Request,
  allowedOrigins?: string[] | ((origin: string) => boolean),
): Response | null {
  if (!allowedOrigins) return null;

  const origin = extractRequestOrigin(request);
  if (!origin) {
    return jsonResponse({ error: 'Forbidden origin' }, 403);
  }

  let allowed = false;
  try {
    allowed =
      typeof allowedOrigins === 'function'
        ? Boolean(allowedOrigins(origin))
        : allowedOrigins.includes(origin);
  } catch {
    allowed = false;
  }

  if (!allowed) {
    return jsonResponse({ error: 'Forbidden origin' }, 403);
  }

  return null;
}

export async function runAuthorize(
  authorize: UploadHttpHandlerOptions['authorize'],
  ctx: AuthorizeContext,
): Promise<Response | null> {
  if (!authorize) return null;

  try {
    const allowed = await authorize(ctx);
    if (!allowed) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    return null;
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
}

export interface BoundedFormDataResult {
  formData?: FormData;
  earlyErrorResponse?: Response;
}

export async function readBoundedFormData(
  request: Request,
  maxBodyBytes: number,
): Promise<BoundedFormDataResult> {
  const contentLengthRaw = request.headers.get('content-length');
  if (contentLengthRaw !== null && contentLengthRaw.trim() !== '') {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return {
        earlyErrorResponse: jsonResponse(
          {
            error: `Payload too large: request body (${contentLength} bytes) exceeds limit of ${maxBodyBytes} bytes`,
          },
          413,
        ),
      };
    }
  }

  if (!request.body) {
    try {
      const formData = await request.formData();
      return { formData };
    } catch {
      return {};
    }
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBodyBytes) {
          await reader.cancel().catch(() => {});
          return {
            earlyErrorResponse: jsonResponse(
              {
                error: `Payload too large: streamed body exceeds limit of ${maxBodyBytes} bytes`,
              },
              413,
            ),
          };
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release errors
    }
  }

  if (totalBytes === 0) {
    return {};
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const formData = await new Response(combined, {
      headers: request.headers,
    }).formData();
    return { formData };
  } catch {
    return {};
  }
}
