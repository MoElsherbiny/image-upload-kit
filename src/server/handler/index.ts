import { createDeleteHandler } from './deleteRoute';
import { handleFinalizeRequest } from './finalizeRoute';
import {
  checkAllowedOrigin,
  readBoundedFormData,
  resolveMaxBodyBytes,
  runAuthorize,
} from './guards';
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
  handleUnexpectedError,
  isClientValidationError,
  jsonResponse,
  UploadValidationError,
} from './responses';
import {
  type PresignTokenPayload,
  type PresignTokenStore,
  signUploadToken,
  type VerifyUploadTokenOptions,
  verifyUploadToken,
} from './uploadToken';

export {
  type AllowClientOverrides,
  type AuthorizeContext,
  isClientValidationError,
  type PresignedHandlerOptions,
  type PresignTokenPayload,
  type PresignTokenStore,
  signUploadToken,
  sweepStagedUploads,
  type UploadErrorContext,
  type UploadHttpHandlerOptions,
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

      const parsed = parseUploadForm(formData, authCtx, options);
      if (parsed.errorResponse) return parsed.errorResponse;

      const result = await uploader.uploadImage(
        parsed.file!,
        parsed.uploadOptions,
      );

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
