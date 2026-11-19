import { UploadKitError } from '../../types/errors';
import type { QuotaContext, RateLimitContext } from '../../types/rateLimit';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import { errorResponseFromKitError } from './responses';

function extractClientIp(request: Request): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  return undefined;
}

export async function resolveSubject<TPreset extends string>(
  getSubject: UploadHttpHandlerOptions<TPreset>['getSubject'],
  ctx: AuthorizeContext,
): Promise<string | undefined> {
  if (!getSubject) return undefined;
  const raw = await getSubject(ctx);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveRateLimitKey(
  request: Request,
  subject?: string,
  customKeyFn?: (req: Request, subject?: string) => string,
): string {
  if (customKeyFn) {
    const custom = customKeyFn(request, subject);
    if (custom) return custom;
  }
  if (subject) return `sub:${subject}`;
  const ip = extractClientIp(request);
  return ip ? `ip:${ip}` : 'anonymous';
}

export async function enforceRateLimit<TPreset extends string>(
  options: UploadHttpHandlerOptions<TPreset>,
  params: {
    action: RateLimitContext['action'];
    request: Request;
    subject?: string;
    bucket?: string;
    preset?: string;
    contentLength?: number;
  },
): Promise<Response | null> {
  if (!options.rateLimiter) return null;

  const key = resolveRateLimitKey(
    params.request,
    params.subject,
    options.rateLimitKey,
  );
  const result = await options.rateLimiter.consume({
    action: params.action,
    key,
    ...(params.subject ? { subject: params.subject } : {}),
    ...(params.bucket ? { bucket: params.bucket } : {}),
    ...(params.preset ? { preset: params.preset } : {}),
    ...(params.contentLength !== undefined
      ? { contentLength: params.contentLength }
      : {}),
  });

  if (result.allowed) return null;

  const retryAfterSeconds =
    typeof result.retryAfterSeconds === 'number' &&
    Number.isFinite(result.retryAfterSeconds) &&
    result.retryAfterSeconds > 0
      ? Math.ceil(result.retryAfterSeconds)
      : undefined;

  const err = new UploadKitError(result.reason ?? 'Too many requests', {
    code: 'RATE_LIMITED',
    status: 429,
    retryable: true,
    ...(retryAfterSeconds !== undefined
      ? { metadata: { retryAfterSeconds } }
      : {}),
  });

  return errorResponseFromKitError(
    err,
    retryAfterSeconds !== undefined
      ? { 'Retry-After': String(retryAfterSeconds) }
      : undefined,
  );
}

export async function enforceQuota<TPreset extends string>(
  options: UploadHttpHandlerOptions<TPreset>,
  params: {
    action: QuotaContext['action'];
    request: Request;
    subject?: string;
    bytes: number;
    bucket?: string;
    preset?: string;
  },
): Promise<Response | null> {
  if (!options.quotaProvider) return null;

  const subject =
    params.subject ??
    resolveRateLimitKey(params.request, undefined, options.rateLimitKey);

  const result = await options.quotaProvider.check({
    action: params.action,
    subject,
    bytes: Math.max(0, params.bytes),
    ...(params.bucket ? { bucket: params.bucket } : {}),
    ...(params.preset ? { preset: params.preset } : {}),
  });

  if (result.allowed) return null;

  const retryAfterSeconds =
    typeof result.retryAfterSeconds === 'number' &&
    Number.isFinite(result.retryAfterSeconds) &&
    result.retryAfterSeconds > 0
      ? Math.ceil(result.retryAfterSeconds)
      : undefined;

  const err = new UploadKitError(result.reason ?? 'Storage quota exceeded', {
    code: 'RESOURCE_LIMIT_EXCEEDED',
    status: 429,
    retryable: false,
    ...(retryAfterSeconds !== undefined
      ? { metadata: { retryAfterSeconds } }
      : {}),
  });

  return errorResponseFromKitError(
    err,
    retryAfterSeconds !== undefined
      ? { 'Retry-After': String(retryAfterSeconds) }
      : undefined,
  );
}

export async function recordQuotaUsage<TPreset extends string>(
  options: UploadHttpHandlerOptions<TPreset>,
  params: {
    action: QuotaContext['action'];
    request: Request;
    subject?: string;
    bytes: number;
    bucket?: string;
    preset?: string;
  },
): Promise<void> {
  if (!options.quotaProvider?.recordUsage) return;
  const subject =
    params.subject ??
    resolveRateLimitKey(params.request, undefined, options.rateLimitKey);
  try {
    await options.quotaProvider.recordUsage({
      action: params.action,
      subject,
      bytes: Math.max(0, params.bytes),
      ...(params.bucket ? { bucket: params.bucket } : {}),
      ...(params.preset ? { preset: params.preset } : {}),
    });
  } catch {
    // Non-fatal quota telemetry failure
  }
}
