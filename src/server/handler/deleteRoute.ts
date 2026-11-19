import { parsePublicStorageUrl } from '../../storage/urlParser';
import { checkAllowedOrigin, kitErrorResponse, runAuthorize } from './guards';
import type { AuthorizeContext, UploadHttpHandlerOptions } from './options';
import { enforceRateLimit, resolveSubject } from './rateLimitGuard';
import { handleUnexpectedError, jsonResponse } from './responses';

function parseVirtualHostedS3Bucket(url: string): {
  bucket: string;
  path: string;
} | null {
  try {
    const parsed = new URL(url);
    const s3Match = parsed.hostname.match(
      /^([a-z0-9.-]+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i,
    );
    if (s3Match) {
      const key = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      if (key) {
        return { bucket: s3Match[1], path: key };
      }
    }
  } catch {
    // Ignore invalid URLs
  }
  return null;
}

function resolveAllowedBuckets<TPreset extends string>(
  options: UploadHttpHandlerOptions<TPreset>,
): Set<string> {
  if (options.allowedBuckets && options.allowedBuckets.length > 0) {
    return new Set(options.allowedBuckets);
  }
  if (typeof options.uploader.getAllowedBuckets === 'function') {
    return new Set(options.uploader.getAllowedBuckets());
  }
  if (options.uploader.defaultBucket) {
    return new Set([options.uploader.defaultBucket]);
  }
  return new Set(['images']);
}

export function createDeleteHandler<TPreset extends string>(
  options: UploadHttpHandlerOptions<TPreset>,
) {
  const {
    uploader,
    authorize,
    allowedOrigins,
    allowClientBucketOverride = false,
    allowedBuckets,
    onError,
  } = options;

  return async function DELETE(request: Request): Promise<Response> {
    try {
      const originError = checkAllowedOrigin(request, allowedOrigins);
      if (originError) return originError;

      const { searchParams } = new URL(request.url, 'http://localhost');
      const url = searchParams.get('url');
      const storagePath = searchParams.get('path');
      const bucketParam = searchParams.get('bucket');

      const allowedBucketSet = resolveAllowedBuckets(options);

      const parsedFromUrl = url
        ? (typeof uploader.parseUrl === 'function'
            ? uploader.parseUrl(url)
            : null) ??
          parsePublicStorageUrl(url) ??
          parseVirtualHostedS3Bucket(url)
        : null;

      const resolvedPath = parsedFromUrl?.path ?? storagePath ?? undefined;
      const resolvedBucket =
        parsedFromUrl?.bucket ??
        (bucketParam || uploader.defaultBucket || 'images');

      const authCtx: AuthorizeContext = {
        action: 'delete',
        request,
        ...(resolvedPath ? { path: resolvedPath } : {}),
        ...(resolvedBucket ? { bucket: resolvedBucket } : {}),
      };
      const authError = await runAuthorize(authorize, authCtx);
      if (authError) return authError;

      const subject = await resolveSubject(options.getSubject, authCtx);
      const rateLimitError = await enforceRateLimit(options, {
        action: 'delete',
        request,
        subject,
        bucket: resolvedBucket,
      });
      if (rateLimitError) return rateLimitError;

      if (url) {
        if (parsedFromUrl?.bucket) {
          if (
            allowedBuckets &&
            allowedBuckets.length > 0 &&
            !allowedBuckets.includes(parsedFromUrl.bucket)
          ) {
            return kitErrorResponse(
              `Forbidden bucket "${parsedFromUrl.bucket}"`,
              'FORBIDDEN',
              403,
              false,
            );
          }
          if (
            !allowClientBucketOverride &&
            allowedBucketSet.size > 0 &&
            !allowedBucketSet.has(parsedFromUrl.bucket)
          ) {
            return kitErrorResponse(
              `Forbidden bucket "${parsedFromUrl.bucket}"`,
              'FORBIDDEN',
              403,
              false,
            );
          }
        }

        const deleted = await uploader.deleteByUrl(url);
        if (!deleted) {
          return jsonResponse(
            {
              success: false,
              error: 'Image not found or could not be deleted',
              code: 'INVALID_IMAGE',
              retryable: false,
            },
            400,
          );
        }
        return jsonResponse({ success: true }, 200);
      }

      if (bucketParam) {
        if (
          allowedBuckets &&
          allowedBuckets.length > 0 &&
          !allowedBuckets.includes(bucketParam)
        ) {
          return kitErrorResponse(
            `Forbidden bucket "${bucketParam}"`,
            'FORBIDDEN',
            403,
            false,
          );
        }
        if (
          !allowClientBucketOverride &&
          allowedBucketSet.size > 0 &&
          !allowedBucketSet.has(bucketParam)
        ) {
          return kitErrorResponse(
            `Forbidden bucket "${bucketParam}"`,
            'FORBIDDEN',
            403,
            false,
          );
        }
      }

      if (!storagePath) {
        return kitErrorResponse(
          'Missing required "path" or "url" query parameter',
          'INVALID_IMAGE',
          400,
          false,
        );
      }

      const bucket = allowClientBucketOverride
        ? bucketParam || undefined
        : undefined;

      await uploader.deleteImage(storagePath, bucket);
      return jsonResponse({ success: true }, 200);
    } catch (error) {
      return handleUnexpectedError(
        error,
        { action: 'delete', request },
        onError,
      );
    }
  };
}
