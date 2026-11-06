import { parsePublicStorageUrl } from '../../storage/urlParser';
import { checkAllowedOrigin, runAuthorize } from './guards';
import type { UploadHttpHandlerOptions } from './options';
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

      const { searchParams } = new URL(request.url);
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

      const authError = await runAuthorize(authorize, {
        action: 'delete',
        request,
        ...(resolvedPath ? { path: resolvedPath } : {}),
        ...(resolvedBucket ? { bucket: resolvedBucket } : {}),
      });
      if (authError) return authError;

      if (url) {
        if (parsedFromUrl?.bucket) {
          if (
            allowedBuckets &&
            allowedBuckets.length > 0 &&
            !allowedBuckets.includes(parsedFromUrl.bucket)
          ) {
            return jsonResponse(
              { error: `Forbidden bucket "${parsedFromUrl.bucket}"` },
              403,
            );
          }
          if (
            !allowClientBucketOverride &&
            allowedBucketSet.size > 0 &&
            !allowedBucketSet.has(parsedFromUrl.bucket)
          ) {
            return jsonResponse(
              { error: `Forbidden bucket "${parsedFromUrl.bucket}"` },
              403,
            );
          }
        }

        const deleted = await uploader.deleteByUrl(url);
        return jsonResponse({ success: deleted }, deleted ? 200 : 400);
      }

      if (bucketParam) {
        if (
          allowedBuckets &&
          allowedBuckets.length > 0 &&
          !allowedBuckets.includes(bucketParam)
        ) {
          return jsonResponse(
            { error: `Forbidden bucket "${bucketParam}"` },
            403,
          );
        }
        if (
          !allowClientBucketOverride &&
          allowedBucketSet.size > 0 &&
          !allowedBucketSet.has(bucketParam)
        ) {
          return jsonResponse(
            { error: `Forbidden bucket "${bucketParam}"` },
            403,
          );
        }
      }

      if (!storagePath) {
        return jsonResponse(
          { error: 'Missing required "path" or "url" query parameter' },
          400,
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
