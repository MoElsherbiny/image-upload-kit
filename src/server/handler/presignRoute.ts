import type { StorageAdapter } from '../../storage/types';
import { DEFAULT_ALLOWED_FORMATS } from '../../types';
import { validateImageFileStrict } from '../../utils/validators';
import {
  checkAllowedOrigin,
  normalizeOverrides,
  runAuthorize,
  sanitizeFolderSegment,
} from './guards';
import type {
  AuthorizeContext,
  UploadHttpHandlerOptions,
} from './options';
import { handleUnexpectedError, jsonResponse } from './responses';
import { type PresignTokenPayload, signUploadToken } from './uploadToken';

export async function readBoundedJsonBody(
  request: Request,
  maxBytes = 16_384,
): Promise<{ body?: Record<string, unknown>; errorResponse?: Response }> {
  const contentLengthRaw = request.headers.get('content-length');
  if (contentLengthRaw !== null && contentLengthRaw.trim() !== '') {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { errorResponse: jsonResponse({ error: 'Request body too large' }, 413) };
    }
  }
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return { errorResponse: jsonResponse({ error: 'Invalid JSON request body' }, 400) };
  }
  if (rawText.length > maxBytes) {
    return { errorResponse: jsonResponse({ error: 'Request body too large' }, 413) };
  }
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { errorResponse: jsonResponse({ error: 'Invalid JSON request body' }, 400) };
    }
    return { body: parsed as Record<string, unknown> };
  } catch {
    return { errorResponse: jsonResponse({ error: 'Invalid JSON request body' }, 400) };
  }
}

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

function generateUuid(): string {
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

function mimeToStagingExtension(contentType: string): string {
  const clean = contentType.toLowerCase().trim();
  if (clean === 'image/jpeg' || clean === 'image/jpg') return 'jpg';
  if (clean === 'image/png') return 'png';
  if (clean === 'image/webp') return 'webp';
  if (clean === 'image/avif') return 'avif';
  if (clean === 'image/svg+xml') return 'svg';
  return 'bin';
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
      return jsonResponse({ error: 'Presigned uploads are not enabled on this endpoint' }, 404);
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

    if (preset) {
      if (allowedPresets && allowedPresets.length > 0 && !allowedPresets.includes(preset)) {
        return jsonResponse(
          { error: `Invalid preset "${preset}". Allowed presets: ${allowedPresets.join(', ')}` },
          400,
        );
      }
      if (typeof uploader.resolvePreset === 'function' && !presetConfig) {
        return jsonResponse({ error: `Invalid preset "${preset}".` }, 400);
      }
    }

    if (rawBucket && allowedBuckets && !allowedBuckets.includes(rawBucket)) {
      return jsonResponse({ error: `Bucket "${rawBucket}" is not allowed` }, 403);
    }

    let folder: string | undefined;
    if (rawFolder !== undefined) {
      if (overrides?.folder === true) {
        folder = sanitizeFolderSegment(rawFolder);
      } else if (typeof overrides?.folder === 'function') {
        const scoped = overrides.folder(rawFolder, authCtx);
        if (scoped === null) {
          return jsonResponse({ error: 'Invalid or disallowed folder' }, 400);
        }
        folder = scoped ? sanitizeFolderSegment(scoped) : undefined;
      }
    }

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
      return jsonResponse({ error: 'Missing required "contentType" field' }, 400);
    }
    if (size !== undefined && (!Number.isFinite(size) || size <= 0)) {
      return jsonResponse({ error: 'File is empty' }, 400);
    }

    const fileCheck = validateImageFileStrict(
      { size: size ?? 1, type: contentType },
      limits.maxSizeMB,
      limits.allowedFormats,
    );
    if (!fileCheck.valid) {
      return jsonResponse({ error: fileCheck.error }, 400);
    }

    const storage = uploader.getStorage?.() ?? uploader.storage;
    if (!storage || typeof storage.createPresignedUpload !== 'function') {
      return jsonResponse(
        { error: 'Storage adapter does not support presigned uploads' },
        501,
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
    const jti = generateUuid();
    const ext = mimeToStagingExtension(contentType);
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
