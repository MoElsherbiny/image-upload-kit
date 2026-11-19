import { isRetryableUploadError } from '../../types/errors';
import { parseFinalizeOverrides } from './finalizeOverrides';
import {
  checkAllowedOrigin,
  kitErrorResponse,
  normalizeOverrides,
  runAuthorize,
} from './guards';
import type {
  AuthorizeContext,
  UploadErrorContext,
  UploadHttpHandlerOptions,
} from './options';
import {
  enforceQuota,
  enforceRateLimit,
  recordQuotaUsage,
  resolveSubject,
} from './rateLimitGuard';
import { handleUnexpectedError, jsonResponse } from './responses';
import { readBoundedJsonBody } from './streamBody';
import { consumeUploadToken, releaseUploadToken, verifyUploadToken } from './uploadToken';

function reportErrorSafe(
  onError: UploadHttpHandlerOptions['onError'],
  error: unknown,
  ctx: UploadErrorContext,
): void {
  try {
    onError?.(error, ctx);
  } catch {
    // Ignore secondary logger failures
  }
}

export async function handleFinalizeRequest<TPreset extends string>(
  request: Request,
  options: UploadHttpHandlerOptions<TPreset>,
): Promise<Response> {
  const { uploader, authorize, allowedOrigins, presigned, onError } = options;
  const errCtx: UploadErrorContext = { action: 'upload', request };

  try {
    if (!presigned || !presigned.secret) {
      return kitErrorResponse('Presigned uploads are not enabled on this endpoint', 'FORBIDDEN', 404, false);
    }

    const originError = checkAllowedOrigin(request, allowedOrigins);
    if (originError) return originError;

    const { body, errorResponse } = await readBoundedJsonBody(request, 16_384);
    if (errorResponse || !body) return errorResponse!;

    const rawToken = typeof body.token === 'string' ? body.token : '';
    if (!rawToken) {
      return kitErrorResponse('Missing required upload token', 'INVALID_UPLOAD_TOKEN', 400, false);
    }

    // 1. Verify signature, claims & expiry WITHOUT consuming jti yet
    const tokenPayload = await verifyUploadToken(rawToken, presigned.secret, {
      consume: false,
      clockToleranceMs: presigned.clockToleranceMs,
    });

    const targetBucket =
      tokenPayload.targetBucket ??
      (!presigned.stagingBucket || tokenPayload.bucket !== presigned.stagingBucket ? tokenPayload.bucket : undefined);
    const authBucket = targetBucket ?? uploader.defaultBucket ?? tokenPayload.bucket;

    const authCtx: AuthorizeContext = {
      action: 'upload',
      request,
      bucket: authBucket,
      ...(tokenPayload.folder ? { path: tokenPayload.folder } : {}),
      ...(tokenPayload.preset ? { preset: tokenPayload.preset } : {}),
    };

    // 2. Authorize caller BEFORE consuming single-use token
    const authError = await runAuthorize(authorize, authCtx);
    if (authError) return authError;

    // 3. Enforce subject binding when token carries `sub`
    const currentSubject = await resolveSubject(options.getSubject, authCtx);
    if (tokenPayload.sub !== undefined && currentSubject !== tokenPayload.sub) {
      return kitErrorResponse('Upload token subject mismatch', 'FORBIDDEN', 403, false);
    }

    // 4. Enforce rate limit before consuming token
    const rateLimitError = await enforceRateLimit(options, {
      action: 'finalize',
      request,
      subject: currentSubject,
      bucket: authBucket,
      preset: tokenPayload.preset,
    });
    if (rateLimitError) return rateLimitError;

    // 5. Atomically consume jti only after caller is verified and authorized
    await consumeUploadToken(tokenPayload.jti, tokenPayload.exp, presigned.tokenStore);

    const storage = uploader.getStorage?.() ?? uploader.storage;
    if (!storage || typeof storage.download !== 'function') {
      return kitErrorResponse('Storage adapter does not support download for presigned finalize', 'STORAGE_ERROR', 501, false);
    }

    let preserveStagedForRetry = false;
    try {
      if (typeof storage.stat === 'function') {
        const meta = await storage.stat(tokenPayload.bucket, tokenPayload.path);
        if (meta && meta.size > tokenPayload.maxBytes) {
          return kitErrorResponse(
            `Staged file size (${meta.size} bytes) exceeds maximum allowed (${tokenPayload.maxBytes} bytes)`,
            'FILE_TOO_LARGE',
            400,
            false,
          );
        }
      }

      let stagedBytes: Uint8Array;
      try {
        stagedBytes = await storage.download(tokenPayload.bucket, tokenPayload.path, { maxBytes: tokenPayload.maxBytes });
      } catch (err) {
        if (err instanceof Error && err.message.includes('exceeds maximum allowed')) {
          return kitErrorResponse(err.message, 'FILE_TOO_LARGE', 400, false);
        }
        if (isRetryableUploadError(err)) throw err;
        return kitErrorResponse('Staged upload object not found', 'INVALID_IMAGE', 400, false);
      }

      if (!stagedBytes || stagedBytes.byteLength === 0) {
        return kitErrorResponse('Staged file is empty', 'INVALID_IMAGE', 400, false);
      }
      if (stagedBytes.byteLength > tokenPayload.maxBytes) {
        return kitErrorResponse(
          `Staged file size (${stagedBytes.byteLength} bytes) exceeds maximum allowed (${tokenPayload.maxBytes} bytes)`,
          'FILE_TOO_LARGE',
          400,
          false,
        );
      }

      const quotaError = await enforceQuota(options, {
        action: 'finalize',
        request,
        subject: currentSubject,
        bytes: stagedBytes.byteLength,
        bucket: authBucket,
        preset: tokenPayload.preset,
      });
      if (quotaError) return quotaError;

      const presetConfig =
        tokenPayload.preset && typeof uploader.resolvePreset === 'function'
          ? uploader.resolvePreset(tokenPayload.preset)
          : undefined;
      const parsed = parseFinalizeOverrides(body, normalizeOverrides(options.allowClientOverrides), presetConfig);
      if (parsed.errorResponse) return parsed.errorResponse;

      const result = await uploader.uploadImage(
        {
          buffer: Buffer.from(stagedBytes.buffer, stagedBytes.byteOffset, stagedBytes.byteLength),
          name: tokenPayload.originalName,
          type: tokenPayload.contentType,
          size: stagedBytes.byteLength,
        },
        {
          preset: tokenPayload.preset as TPreset | undefined,
          folder: tokenPayload.folder,
          bucket: targetBucket,
          altText: parsed.altText,
          customFilename: parsed.customFilename,
          ...(parsed.customFilename ? { isClientFilename: true } : {}),
          outputFormat: parsed.outputFormat,
          quality: parsed.quality,
          maxDimensions: parsed.maxDimensions,
          ...(parsed.aspectRatio !== undefined ? { aspectRatio: parsed.aspectRatio } : {}),
          ...(parsed.crop !== undefined ? { crop: parsed.crop } : {}),
          metadata: parsed.metadata,
          signal: request.signal,
        },
      );

      await recordQuotaUsage(options, {
        action: 'finalize',
        request,
        subject: currentSubject,
        bytes: result.size ?? stagedBytes.byteLength,
        bucket: result.bucket,
        preset: result.preset,
      });

      return jsonResponse(result, 200);
    } catch (innerErr) {
      if (isRetryableUploadError(innerErr)) {
        preserveStagedForRetry = true;
        await releaseUploadToken(tokenPayload.jti, presigned.tokenStore).catch((relErr) => {
          reportErrorSafe(onError, relErr, errCtx);
        });
      }
      throw innerErr;
    } finally {
      if (!preserveStagedForRetry) {
        await storage.delete(tokenPayload.bucket, tokenPayload.path).catch((cleanupErr) => {
          reportErrorSafe(onError, cleanupErr, errCtx);
        });
      }
    }
  } catch (error) {
    return handleUnexpectedError(error, errCtx, onError);
  }
}
