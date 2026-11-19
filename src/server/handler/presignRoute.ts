import type { StorageAdapter } from '../../storage/types';
import { DEFAULT_ALLOWED_FORMATS } from '../../types';
import { validateImageFileStrict } from '../../utils/validators';
import {
  checkAllowedOrigin,
  generateId,
  kitErrorResponse,
  mimeToExtension,
  normalizeOverrides,
  resolveClientFolder,
  runAuthorize,
  sanitizeFolderSegment,
} from './guards';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import {
  enforceQuota,
  enforceRateLimit,
  resolveSubject,
} from './rateLimitGuard';
import { handleUnexpectedError, jsonResponse } from './responses';
import { readBoundedJsonBody } from './streamBody';
import { type PresignTokenPayload, signUploadToken } from './uploadToken';

export { readBoundedJsonBody };

export async function sweepStagedUploads(options: {
  storage: StorageAdapter;
  bucket: string;
  stagingPrefix?: string;
  maxAgeMs?: number;
  now?: number;
}): Promise<{ deleted: number }> {
  const { storage, bucket, maxAgeMs = 3_600_000, now = Date.now() } = options;
  if (typeof storage.list !== 'function') return { deleted: 0 };
  const cleanPrefix = (options.stagingPrefix ?? '_staging/').replace(/^\/+|\/+$/g, '');
  const entries = await storage.list(bucket, cleanPrefix || undefined);
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.createdAt) continue;
    const createdMs = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdMs) || now - createdMs < maxAgeMs) continue;
    const entryPath =
      cleanPrefix && !entry.name.startsWith(`${cleanPrefix}/`)
        ? `${cleanPrefix}/${entry.name}`
        : entry.name;
    await storage.delete(bucket, entryPath);
    deleted++;
  }
  return { deleted };
}

export async function handlePresignRequest<TPreset extends string>(
  request: Request,
  options: UploadHttpHandlerOptions<TPreset>,
): Promise<Response> {
  const {
    uploader, authorize, allowedOrigins, allowedPresets,
    allowClientBucketOverride = false, allowedBuckets, presigned, onError,
  } = options;

  try {
    if (!presigned || !presigned.secret) {
      return kitErrorResponse(
        'Presigned uploads are not enabled on this endpoint',
        'FORBIDDEN',
        404,
        false,
      );
    }

    const originError = checkAllowedOrigin(request, allowedOrigins);
    if (originError) return originError;

    const { body, errorResponse } = await readBoundedJsonBody(request, 16_384);
    if (errorResponse || !body) return errorResponse!;

    const overrides = normalizeOverrides(options.allowClientOverrides);
    const preset = typeof body.preset === 'string' && body.preset ? (body.preset as TPreset) : undefined;
    const rawBucket = typeof body.bucket === 'string' && body.bucket ? body.bucket : undefined;
    const rawFolder = typeof body.folder === 'string' ? body.folder : undefined;
    const filename = typeof body.filename === 'string' && body.filename ? body.filename : undefined;
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
    const hasSize = body.size !== undefined && body.size !== null && body.size !== '';
    const size = hasSize ? Number(body.size) : undefined;

    const presetConfig =
      preset && typeof uploader.resolvePreset === 'function'
        ? uploader.resolvePreset(preset)
        : undefined;

    const authBucket = allowClientBucketOverride
      ? rawBucket || presetConfig?.bucket || uploader.defaultBucket
      : presetConfig?.bucket || uploader.defaultBucket;
    const sanitizedRawFolder = rawFolder ? sanitizeFolderSegment(rawFolder) : undefined;
    const authFolder = overrides?.folder
      ? sanitizedRawFolder || presetConfig?.folder
      : presetConfig?.folder;

    const authCtx: AuthorizeContext = {
      action: 'upload',
      request,
      ...(authFolder ? { path: authFolder } : {}),
      ...(authBucket ? { bucket: authBucket } : {}),
      ...(preset ? { preset } : {}),
    };

    const authError = await runAuthorize(authorize, authCtx);
    if (authError) return authError;

    const subject = await resolveSubject(options.getSubject, authCtx);
    const rateLimitError = await enforceRateLimit(options, {
      action: 'presign',
      request,
      subject,
      bucket: authBucket,
      preset,
      contentLength: size,
    });
    if (rateLimitError) return rateLimitError;

    const quotaError = await enforceQuota(options, {
      action: 'presign',
      request,
      subject,
      bytes: size ?? 0,
      bucket: authBucket,
      preset,
    });
    if (quotaError) return quotaError;

    if (preset) {
      if (allowedPresets && allowedPresets.length > 0 && !allowedPresets.includes(preset)) {
        return kitErrorResponse(
          `Invalid preset "${preset}". Allowed presets: ${allowedPresets.join(', ')}`,
          'INVALID_IMAGE',
          400,
          false,
        );
      }
      if (typeof uploader.resolvePreset === 'function' && !presetConfig) {
        return kitErrorResponse(`Invalid preset "${preset}".`, 'INVALID_IMAGE', 400, false);
      }
    }

    if (rawBucket && allowedBuckets && !allowedBuckets.includes(rawBucket)) {
      return kitErrorResponse(`Bucket "${rawBucket}" is not allowed`, 'FORBIDDEN', 403, false);
    }

    const resolvedFolder = resolveClientFolder(rawFolder, overrides, authCtx);
    if (resolvedFolder.errorResponse) return resolvedFolder.errorResponse;
    const folder = resolvedFolder.folder;

    const limits =
      typeof uploader.resolveUploadLimits === 'function'
        ? uploader.resolveUploadLimits(preset)
        : {
            maxSizeMB:
              presetConfig?.maxSizeMB ??
              (typeof uploader.getMaxSizeMB === 'function'
                ? uploader.getMaxSizeMB(preset ? [preset] : allowedPresets)
                : 10),
            allowedFormats: presetConfig?.allowedFormats ?? DEFAULT_ALLOWED_FORMATS,
            allowSvg: Boolean(presetConfig?.allowSvg),
            defaultFolder: presetConfig?.folder ?? '',
          };

    if (!contentType) {
      return kitErrorResponse('Missing required "contentType" field', 'INVALID_IMAGE', 400, false);
    }
    if (size !== undefined && (!Number.isFinite(size) || size <= 0)) {
      return kitErrorResponse('File is empty', 'INVALID_IMAGE', 400, false);
    }

    const fileCheck = validateImageFileStrict(
      { size: size ?? 1, type: contentType },
      limits.maxSizeMB,
      limits.allowedFormats,
    );
    if (!fileCheck.valid) {
      const code = fileCheck.error?.includes('exceeds maximum')
        ? 'FILE_TOO_LARGE'
        : 'UNSUPPORTED_FORMAT';
      return kitErrorResponse(fileCheck.error || 'Invalid file', code, 400, false);
    }

    const storage = uploader.getStorage?.() ?? uploader.storage;
    if (!storage || typeof storage.createPresignedUpload !== 'function') {
      return kitErrorResponse(
        'Storage adapter does not support presigned uploads',
        'STORAGE_ERROR',
        501,
        false,
      );
    }

    const targetBucket =
      (allowClientBucketOverride ? rawBucket : undefined) ||
      presetConfig?.bucket ||
      uploader.defaultBucket ||
      'images';
    const stagingBucket = presigned.stagingBucket || targetBucket;

    const rawPrefix = (presigned.stagingPrefix ?? '_staging/').replace(/^\/+/, '');
    const stagingPrefix =
      rawPrefix && !rawPrefix.endsWith('/') ? `${rawPrefix}/` : rawPrefix;
    const jti = generateId();
    const ext = mimeToExtension(contentType);
    const stagingPath = `${stagingPrefix}${jti}.${ext}`;
    const expiresInSeconds = presigned.expiresInSeconds ?? 300;
    const maxBytes = Math.floor(limits.maxSizeMB * 1024 * 1024);
    const exp = Date.now() + expiresInSeconds * 1000;
    const expiresAt = new Date(exp).toISOString();

    const upload = await storage.createPresignedUpload({
      bucket: stagingBucket,
      path: stagingPath,
      contentType,
      maxBytes,
      expiresInSeconds,
    });

    const tokenPayload: PresignTokenPayload = {
      v: 1,
      jti,
      exp,
      bucket: stagingBucket,
      path: stagingPath,
      contentType,
      maxBytes,
      ...(subject ? { sub: subject } : {}),
      ...(targetBucket ? { targetBucket } : {}),
      ...(preset ? { preset } : {}),
      ...(folder ? { folder } : {}),
      ...(filename ? { originalName: filename } : {}),
    };
    const token = await signUploadToken(tokenPayload, presigned.secret);

    return jsonResponse(
      {
        upload,
        token,
        expiresAt: upload.expiresAt ?? expiresAt,
        bucket: stagingBucket,
        path: stagingPath,
      },
      200,
    );
  } catch (error) {
    return handleUnexpectedError(error, { action: 'upload', request }, onError);
  }
}
