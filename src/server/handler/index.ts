import { createDeleteHandler } from './deleteRoute';
import {
  checkAllowedOrigin,
  readBoundedFormData,
  resolveMaxBodyBytes,
  runAuthorize,
} from './guards';
import type {
  AllowClientOverrides,
  AuthorizeContext,
  UploadErrorContext,
  UploadHttpHandlerOptions,
} from './options';
import { parseUploadForm, peekUploadAuthContext } from './parseUploadForm';
import {
  handleUnexpectedError,
  isClientValidationError,
  jsonResponse,
  UploadValidationError,
} from './responses';

export {
  type AllowClientOverrides,
  type AuthorizeContext,
  isClientValidationError,
  type UploadErrorContext,
  type UploadHttpHandlerOptions,
  UploadValidationError,
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
