import { UploadKitError } from '../../types/errors';
import type { QuotaContext, RateLimitContext } from '../../types/rateLimit';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import { errorResponseFromKitError } from './responses';

/** Subset of handler options consumed by `enforceRateLimit`. */
export type RateLimitGuardOptions = Pick<
  UploadHttpHandlerOptions,
  'rateLimiter' | 'rateLimitKey' | 'trustProxy'
>;

/** Subset of handler options consumed by `enforceQuota` / `recordQuotaUsage`. */
export type QuotaGuardOptions = Pick<
  UploadHttpHandlerOptions,
  'quotaProvider' | 'rateLimitKey' | 'trustProxy'
>;

function resolveTrustedHops(trustProxy: boolean | number | undefined): number {
  if (trustProxy === true) return 1;
  if (typeof trustProxy === 'number' && Number.isFinite(trustProxy) && trustProxy >= 1) {
    return Math.floor(trustProxy);
  }
  return 0;
}

/**
 * Resolves the client IP from proxy headers ONLY when `trustProxy` is enabled.
 * With N trusted hops, picks the `X-Forwarded-For` entry N positions from the right
 * (the address appended by your outermost trusted proxy), never the client-controlled leftmost entry.
 */
export function extractClientIp(
  request: Request,
  trustProxy?: boolean | number,
): string | undefined {
  const hops = resolveTrustedHops(trustProxy);
  if (hops === 0) return undefined;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (entries.length > 0) {
      return entries[Math.max(0, entries.length - hops)];
    }
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
  trustProxy?: boolean | number,
): string {
  if (customKeyFn) {
    const custom = customKeyFn(request, subject);
    if (custom) return custom;
  }
  if (subject) return `sub:${subject}`;
  const ip = extractClientIp(request, trustProxy);
  return ip ? `ip:${ip}` : 'anonymous';
}

function limitErrorResponse(
  message: string,
  code: 'RATE_LIMITED' | 'RESOURCE_LIMIT_EXCEEDED',
  retryable: boolean,
  rawRetryAfter: number | undefined,
): Response {
  const retryAfterSeconds =
    typeof rawRetryAfter === 'number' && Number.isFinite(rawRetryAfter) && rawRetryAfter > 0
      ? Math.ceil(rawRetryAfter)
      : undefined;
  const err = new UploadKitError(message, {
    code,
    status: 429,
    retryable,
    ...(retryAfterSeconds !== undefined ? { metadata: { retryAfterSeconds } } : {}),
  });
  return errorResponseFromKitError(
    err,
    retryAfterSeconds !== undefined ? { 'Retry-After': String(retryAfterSeconds) } : undefined,
  );
}

export async function enforceRateLimit(
  options: RateLimitGuardOptions,
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
    options.trustProxy,
  );
  const result = await options.rateLimiter.consume({
    action: params.action,
    key,
    ...(params.subject ? { subject: params.subject } : {}),
    ...(params.bucket ? { bucket: params.bucket } : {}),
    ...(params.preset ? { preset: params.preset } : {}),
    ...(params.contentLength !== undefined ? { contentLength: params.contentLength } : {}),
  });

  if (result.allowed) return null;
  return limitErrorResponse(result.reason ?? 'Too many requests', 'RATE_LIMITED', true, result.retryAfterSeconds);
}

interface QuotaParams {
  action: QuotaContext['action'];
  request: Request;
  subject?: string;
  bytes: number;
  bucket?: string;
  preset?: string;
}

function buildQuotaContext(options: QuotaGuardOptions, params: QuotaParams): QuotaContext {
  const subject =
    params.subject ??
    resolveRateLimitKey(params.request, undefined, options.rateLimitKey, options.trustProxy);
  return {
    action: params.action,
    subject,
    bytes: Math.max(0, params.bytes),
    ...(params.bucket ? { bucket: params.bucket } : {}),
    ...(params.preset ? { preset: params.preset } : {}),
  };
}

export async function enforceQuota(
  options: QuotaGuardOptions,
  params: QuotaParams,
): Promise<Response | null> {
  if (!options.quotaProvider) return null;
  const result = await options.quotaProvider.check(buildQuotaContext(options, params));
  if (result.allowed) return null;
  return limitErrorResponse(
    result.reason ?? 'Storage quota exceeded',
    'RESOURCE_LIMIT_EXCEEDED',
    false,
    result.retryAfterSeconds,
  );
}

export async function recordQuotaUsage(
  options: QuotaGuardOptions,
  params: QuotaParams,
): Promise<void> {
  if (!options.quotaProvider?.recordUsage) return;
  try {
    await options.quotaProvider.recordUsage(buildQuotaContext(options, params));
  } catch {
    // Non-fatal quota telemetry failure
  }
}
