import { createDeleteHandler } from './deleteRoute';
import { handleFinalizeRequest } from './finalizeRoute';
import {
  checkAllowedOrigin,
  readBoundedFormData,
  resolveMaxBodyBytes,
  runAuthorize,
} from './guards';
import {
  createMemoryRateLimiter,
  type MemoryRateLimiterOptions,
} from './memoryRateLimiter';
import {
  createMemoryMultipartSessionStore,
  createMultipartUploadHandler,
  type MemoryMultipartSessionStoreOptions,
  type MultipartSessionRecord,
  type MultipartSessionStore,
  type MultipartUploadHandlerOptions,
} from './multipartRoute';
import type {
  AllowClientOverrides,
  AuthorizeContext,
  PresignedHandlerOptions,
  UploadErrorContext,
  UploadHttpHandlerOptions,
} from './options';
import { parseUploadForm, peekUploadAuthContext } from './parseUploadForm';
import { handlePresignRequest, sweepStagedUploads } from './presignRoute';
import {
  enforceQuota,
  enforceRateLimit,
  type QuotaGuardOptions,
  type RateLimitGuardOptions,
  recordQuotaUsage,
  resolveSubject,
} from './rateLimitGuard';
import {
  errorResponseFromKitError,
  handleUnexpectedError,
  isClientValidationError,
  jsonResponse,
  UploadValidationError,
} from './responses';
import {
  createMemoryResumableSessionStore,
  createResumableUploadHandler,
  type MemoryResumableSessionStoreOptions,
  type ResumableSessionRecord,
  type ResumableSessionStore,
  type ResumableUploadHandlerOptions,
} from './resumableRoute';
import {
  type BoundedStreamBytesResult,
  readBoundedStreamBytes,
} from './streamBody';
import {
  consumeUploadToken,
  type PresignTokenPayload,
  type PresignTokenStore,
  releaseUploadToken,
  signUploadToken,
  type UploadTokenSecret,
  type VerifyUploadTokenOptions,
  verifyUploadToken,
} from './uploadToken';

export {
  type AllowClientOverrides,
  type AuthorizeContext,
  type BoundedStreamBytesResult,
  consumeUploadToken,
  createMemoryMultipartSessionStore,
  createMemoryRateLimiter,
  createMemoryResumableSessionStore,
  createMultipartUploadHandler,
  createResumableUploadHandler,
  errorResponseFromKitError,
  isClientValidationError,
  type MemoryMultipartSessionStoreOptions,
  type MemoryRateLimiterOptions,
  type MemoryResumableSessionStoreOptions,
  type MultipartSessionRecord,
  type MultipartSessionStore,
  type MultipartUploadHandlerOptions,
  type PresignedHandlerOptions,
  type PresignTokenPayload,
  type PresignTokenStore,
  type QuotaGuardOptions,
  type RateLimitGuardOptions,
  readBoundedStreamBytes,
  releaseUploadToken,
  type ResumableSessionRecord,
  type ResumableSessionStore,
  type ResumableUploadHandlerOptions,
  signUploadToken,
  sweepStagedUploads,
  type UploadErrorContext,
  type UploadHttpHandlerOptions,
  type UploadTokenSecret,
  UploadValidationError,
  type VerifyUploadTokenOptions,
  verifyUploadToken,
};

/**
 * Standard Web Fetch (`Request` -> `Response`) upload & delete route handlers.
 * Works across Next.js App Router, Remix, React Router, SvelteKit, Astro, Hono, and Node Fetch servers.
 */
export function createUploadHttpHandler<TPreset extends string = string>(
  options: UploadHttpHandlerOptions<TPreset>,
) {
  const { uploader, authorize, allowedOrigins, onError } = options;
  const maxBodyBytes = resolveMaxBodyBytes(options);

  async function POST(request: Request): Promise<Response> {
    try {
      const { searchParams } = new URL(request.url, 'http://localhost');
      const action = searchParams.get('action');
      if (action === 'presign') {
        return handlePresignRequest(request, options);
      }
      if (action === 'finalize') {
        return handleFinalizeRequest(request, options);
      }

      const originError = checkAllowedOrigin(request, allowedOrigins);
      if (originError) return originError;

      const { formData, earlyErrorResponse } = await readBoundedFormData(
        request,
        maxBodyBytes,
      );
      if (earlyErrorResponse) return earlyErrorResponse;

      const authCtx = peekUploadAuthContext(formData, request, options);
      const authError = await runAuthorize(authorize, authCtx);
      if (authError) return authError;

      const subject = await resolveSubject(options.getSubject, authCtx);
      const rateLimitError = await enforceRateLimit(options, {
        action: 'upload',
        request,
        subject,
        bucket: authCtx.bucket,
        preset: authCtx.preset,
      });
      if (rateLimitError) return rateLimitError;

      const parsed = parseUploadForm(formData, authCtx, options);
      if (parsed.errorResponse) return parsed.errorResponse;

      const fileBytes = parsed.file?.size ?? 0;
      const quotaError = await enforceQuota(options, {
        action: 'upload',
        request,
        subject,
        bytes: fileBytes,
        bucket: parsed.uploadOptions?.bucket ?? authCtx.bucket,
        preset: parsed.uploadOptions?.preset,
      });
      if (quotaError) return quotaError;

      const result = await uploader.uploadImage(
        parsed.file!,
        parsed.uploadOptions,
      );

      await recordQuotaUsage(options, {
        action: 'upload',
        request,
        subject,
        bytes: result.size ?? fileBytes,
        bucket: result.bucket,
        preset: result.preset,
      });

      return jsonResponse(result, 200);
    } catch (error) {
      return handleUnexpectedError(
        error,
        { action: 'upload', request },
        onError,
      );
    }
  }

  const DELETE = createDeleteHandler(options);

  return { POST, DELETE };
}

export const createUploadHandler = createUploadHttpHandler;
