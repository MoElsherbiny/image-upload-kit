import { type UploadErrorCode, UploadKitError } from '../../types/errors';
import type {
  AllowClientOverrides,
  AuthorizeContext,
  UploadHttpHandlerOptions,
} from './options';
import { enforceRateLimit, resolveSubject } from './rateLimitGuard';
import { errorResponseFromKitError } from './responses';
import { readBoundedStreamBytes } from './streamBody';

const DEFAULT_FALLBACK_MAX_MB = 25;
const MIN_DEFAULT_BODY_BYTES = 1024 * 1024;

export function kitErrorResponse(
  message: string,
  code: UploadErrorCode,
  status?: number,
  retryable?: boolean,
): Response {
  return errorResponseFromKitError(
    new UploadKitError(message, { code, status, retryable }),
  );
}

export function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function mimeToExtension(contentType: string): string {
  const clean = contentType.toLowerCase().trim();
  if (clean === 'image/jpeg' || clean === 'image/jpg') return 'jpg';
  if (clean === 'image/png') return 'png';
  if (clean === 'image/webp') return 'webp';
  if (clean === 'image/avif') return 'avif';
  if (clean === 'image/svg+xml') return 'svg';
  return 'bin';
}

export function sanitizeMetadataRecord(
  raw: unknown,
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== undefined && v !== null) clean[k] = String(v);
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

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

export function resolveClientFolder(
  rawFolder: string | undefined,
  overrides: AllowClientOverrides | undefined,
  authCtx: AuthorizeContext,
): { folder?: string; errorResponse?: Response } {
  if (rawFolder === undefined) return {};
  if (overrides?.folder === true) {
    return { folder: sanitizeFolderSegment(rawFolder) || undefined };
  }
  if (typeof overrides?.folder === 'function') {
    const scoped = overrides.folder(rawFolder, authCtx);
    if (scoped === null) {
      return {
        errorResponse: kitErrorResponse(
          'Invalid or disallowed folder',
          'INVALID_IMAGE',
          400,
          false,
        ),
      };
    }
    return { folder: scoped ? sanitizeFolderSegment(scoped) : undefined };
  }
  return {};
}

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
  if (originHeader && originHeader !== 'null') return originHeader.trim();
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
    return kitErrorResponse('Forbidden origin', 'FORBIDDEN', 403, false);
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
  return allowed
    ? null
    : kitErrorResponse('Forbidden origin', 'FORBIDDEN', 403, false);
}

export async function runAuthorize(
  authorize: UploadHttpHandlerOptions['authorize'],
  ctx: AuthorizeContext,
): Promise<Response | null> {
  if (!authorize) return null;
  try {
    const allowed = await authorize(ctx);
    return allowed
      ? null
      : kitErrorResponse('Unauthorized', 'UNAUTHORIZED', 401, false);
  } catch {
    return kitErrorResponse('Unauthorized', 'UNAUTHORIZED', 401, false);
  }
}

export async function guardRouteAccess(
  options: Pick<
    UploadHttpHandlerOptions,
    'allowedOrigins' | 'authorize' | 'getSubject' | 'rateLimiter' | 'rateLimitKey' | 'trustProxy'
  >,
  ctx: AuthorizeContext,
  rateAction: 'upload' | 'delete' | 'presign' | 'finalize' = ctx.action,
  contentLength?: number,
): Promise<{ subject?: string; errorResponse?: Response }> {
  const originErr = checkAllowedOrigin(ctx.request, options.allowedOrigins);
  if (originErr) return { errorResponse: originErr };
  const authErr = await runAuthorize(options.authorize, ctx);
  if (authErr) return { errorResponse: authErr };
  const subject = await resolveSubject(options.getSubject, ctx);
  const rateErr = await enforceRateLimit(options, {
    action: rateAction,
    request: ctx.request,
    subject,
    bucket: ctx.bucket,
    preset: ctx.preset,
    ...(contentLength !== undefined ? { contentLength } : {}),
  });
  if (rateErr) return { errorResponse: rateErr };
  return { subject };
}

export interface BoundedFormDataResult {
  formData?: FormData;
  earlyErrorResponse?: Response;
}

export async function readBoundedFormData(
  request: Request,
  maxBodyBytes: number,
): Promise<BoundedFormDataResult> {
  if (!request.body) {
    const contentLengthRaw = request.headers.get('content-length');
    if (contentLengthRaw !== null && contentLengthRaw.trim() !== '') {
      const contentLength = Number(contentLengthRaw);
      if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
        return {
          earlyErrorResponse: kitErrorResponse(
            `Payload too large: request body (${contentLength} bytes) exceeds limit of ${maxBodyBytes} bytes`,
            'FILE_TOO_LARGE',
            413,
            false,
          ),
        };
      }
    }
    try {
      return { formData: await request.formData() };
    } catch {
      return {};
    }
  }

  const { bytes, errorResponse } = await readBoundedStreamBytes(
    request,
    maxBodyBytes,
  );
  if (errorResponse) return { earlyErrorResponse: errorResponse };
  if (!bytes || bytes.byteLength === 0) return {};

  try {
    const formData = await new Response(bytes, {
      headers: request.headers,
    }).formData();
    return { formData };
  } catch {
    return {};
  }
}
