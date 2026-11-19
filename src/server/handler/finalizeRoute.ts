import type {
  CropStrategy,
  ExplicitOutputFormat,
  ImageAspectRatio,
  ImageDimensions,
} from '../../types';
import { resolveAspectRatio } from '../../types/aspectRatio';
import { UploadKitError } from '../../types/errors';
import { checkAllowedOrigin, normalizeOverrides, runAuthorize } from './guards';
import type {
  AuthorizeContext,
  UploadHttpHandlerOptions,
} from './options';
import { readBoundedJsonBody } from './presignRoute';
import {
  enforceQuota,
  enforceRateLimit,
  recordQuotaUsage,
  resolveSubject,
} from './rateLimitGuard';
import {
  errorResponseFromKitError,
  handleUnexpectedError,
  jsonResponse,
} from './responses';
import { consumeUploadToken, verifyUploadToken } from './uploadToken';

const ALLOWED_OUTPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif']);
const ALLOWED_CROP_STRATEGIES = new Set<CropStrategy>(['attention', 'entropy', 'center']);

function sanitizeMetadataObject(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== undefined && v !== null) clean[k] = String(v);
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export async function handleFinalizeRequest<TPreset extends string>(
  request: Request,
  options: UploadHttpHandlerOptions<TPreset>,
): Promise<Response> {
  const { uploader, authorize, allowedOrigins, presigned, onError } = options;

  try {
    if (!presigned || !presigned.secret) {
      return jsonResponse(
        { error: 'Presigned uploads are not enabled on this endpoint' },
        404,
      );
    }

    const originError = checkAllowedOrigin(request, allowedOrigins);
    if (originError) return originError;

    const { body, errorResponse } = await readBoundedJsonBody(request, 16_384);
    if (errorResponse || !body) return errorResponse!;

    const rawToken = typeof body.token === 'string' ? body.token : '';
    if (!rawToken) {
      return jsonResponse({ error: 'Missing required upload token' }, 400);
    }

    // 1. Verify signature, claims & expiry WITHOUT consuming jti yet
    const tokenPayload = await verifyUploadToken(rawToken, presigned.secret, {
      consume: false,
      clockToleranceMs: presigned.clockToleranceMs,
    });

    const targetBucket =
      tokenPayload.targetBucket ??
      (!presigned.stagingBucket || tokenPayload.bucket !== presigned.stagingBucket
        ? tokenPayload.bucket
        : undefined);
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
      return errorResponseFromKitError(
        new UploadKitError('Upload token subject mismatch', {
          code: 'FORBIDDEN',
          status: 403,
        }),
      );
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
    await consumeUploadToken(
      tokenPayload.jti,
      tokenPayload.exp,
      presigned.tokenStore,
    );

    const storage = uploader.getStorage?.() ?? uploader.storage;
    if (!storage || typeof storage.download !== 'function') {
      return jsonResponse(
        { error: 'Storage adapter does not support download for presigned finalize' },
        501,
      );
    }

    try {
      if (typeof storage.stat === 'function') {
        const meta = await storage.stat(tokenPayload.bucket, tokenPayload.path);
        if (meta && meta.size > tokenPayload.maxBytes) {
          return jsonResponse(
            {
              error: `Staged file size (${meta.size} bytes) exceeds maximum allowed (${tokenPayload.maxBytes} bytes)`,
            },
            400,
          );
        }
      }

      let stagedBytes: Uint8Array;
      try {
        stagedBytes = await storage.download(tokenPayload.bucket, tokenPayload.path, {
          maxBytes: tokenPayload.maxBytes,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('exceeds maximum allowed')) {
          return jsonResponse({ error: err.message }, 400);
        }
        return jsonResponse({ error: 'Staged upload object not found' }, 400);
      }

      if (!stagedBytes || stagedBytes.byteLength === 0) {
        return jsonResponse({ error: 'Staged file is empty' }, 400);
      }
      if (stagedBytes.byteLength > tokenPayload.maxBytes) {
        return jsonResponse(
          {
            error: `Staged file size (${stagedBytes.byteLength} bytes) exceeds maximum allowed (${tokenPayload.maxBytes} bytes)`,
          },
          400,
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

      const overrides = normalizeOverrides(options.allowClientOverrides);
      const presetConfig =
        tokenPayload.preset && typeof uploader.resolvePreset === 'function'
          ? uploader.resolvePreset(tokenPayload.preset)
          : undefined;

      const altText = typeof body.altText === 'string' ? body.altText : undefined;
      const customFilename =
        overrides?.filename && typeof body.customFilename === 'string' && body.customFilename
          ? body.customFilename
          : undefined;

      let outputFormat: ExplicitOutputFormat | undefined;
      if (typeof body.outputFormat === 'string' && body.outputFormat) {
        if (!ALLOWED_OUTPUT_FORMATS.has(body.outputFormat)) {
          return jsonResponse(
            { error: `Invalid output format "${body.outputFormat}". Allowed formats: jpeg, png, webp, avif` },
            400,
          );
        }
        if (overrides?.format) {
          outputFormat = body.outputFormat as ExplicitOutputFormat;
        }
      }

      let quality: number | undefined;
      if (body.quality !== undefined && body.quality !== null) {
        const q = Number(body.quality);
        if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1 || q > 100) {
          return jsonResponse(
            { error: `Invalid quality "${body.quality}". Must be an integer between 1 and 100.` },
            400,
          );
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
          return jsonResponse({ error: 'Invalid maxWidth or maxHeight dimensions' }, 400);
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
          return jsonResponse({ error: `Invalid aspectRatio "${String(body.aspectRatio)}"` }, 400);
        }
        if (overrides?.aspectRatio) {
          aspectRatio = body.aspectRatio as Exclude<ImageAspectRatio, 'auto'>;
        }
      }

      let crop: CropStrategy | undefined;
      if (typeof body.crop === 'string' && body.crop) {
        const trimmedCrop = body.crop.trim() as CropStrategy;
        if (!ALLOWED_CROP_STRATEGIES.has(trimmedCrop)) {
          return jsonResponse(
            { error: `Invalid crop "${body.crop}". Allowed values: attention, entropy, center` },
            400,
          );
        }
        if (overrides?.aspectRatio || overrides?.crop) crop = trimmedCrop;
      }

      const metadata = sanitizeMetadataObject(body.metadata);

      const result = await uploader.uploadImage(
        {
          buffer: Buffer.from(
            stagedBytes.buffer,
            stagedBytes.byteOffset,
            stagedBytes.byteLength,
          ),
          name: tokenPayload.originalName,
          type: tokenPayload.contentType,
          size: stagedBytes.byteLength,
        },
        {
          preset: tokenPayload.preset as TPreset | undefined,
          folder: tokenPayload.folder,
          bucket: targetBucket,
          altText,
          customFilename,
          ...(customFilename ? { isClientFilename: true } : {}),
          outputFormat,
          quality,
          maxDimensions,
          ...(aspectRatio !== undefined ? { aspectRatio } : {}),
          ...(crop !== undefined ? { crop } : {}),
          metadata,
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
    } finally {
      await storage.delete(tokenPayload.bucket, tokenPayload.path).catch(() => {});
    }
  } catch (error) {
    return handleUnexpectedError(error, { action: 'upload', request }, onError);
  }
}
