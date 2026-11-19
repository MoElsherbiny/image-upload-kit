import type { UploadedImageData } from '../types';
import { isUploadKitError, UploadKitError } from '../types/errors';
import {
  appendAssetToFormData,
  getAssetMimeType,
  getAssetName,
  getAssetSize,
  isNativeAsset,
} from './asset';
import { createNetworkUploadError } from './errors';
import type {
  PresignedUploadTarget,
  PresignResponsePayload,
  UploadableAsset,
} from './types';
import {
  createHttpUploadError,
  createUploadAbortError,
  isUploadAbortError,
  type UploadFormFields,
  type XhrUploadOptions,
} from './xhrUpload';

function buildActionUrl(endpoint: string, action: 'presign' | 'finalize'): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}action=${action}`;
}

async function fetchWithUploadErrors(
  url: string,
  init: RequestInit,
  networkLabel: string,
  abortedLabel?: string,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: unknown) {
    if (signal?.aborted || isUploadAbortError(err)) {
      throw createUploadAbortError(abortedLabel);
    }
    if (isUploadKitError(err)) throw err;
    throw createNetworkUploadError(networkLabel, err);
  }
}

async function uploadDirectToStorageTarget(
  target: PresignedUploadTarget,
  asset: UploadableAsset,
  options: XhrUploadOptions,
): Promise<void> {
  if (options.signal?.aborted) {
    throw createUploadAbortError(options.abortedErrorLabel);
  }
  const networkLabel =
    options.networkErrorLabel || 'Network error during direct storage upload';

  if (typeof XMLHttpRequest === 'undefined') {
    if (target.method === 'POST') {
      const fd = new FormData();
      if (target.fields) {
        for (const [k, v] of Object.entries(target.fields)) fd.append(k, v);
      }
      appendAssetToFormData(fd, 'file', asset);
      const res = await fetchWithUploadErrors(
        target.url,
        { method: 'POST', body: fd, signal: options.signal },
        networkLabel,
        options.abortedErrorLabel,
        options.signal,
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw createHttpUploadError(res.status, text, 'Direct storage upload failed');
      }
      options.onUploadProgress?.(85);
      return;
    }

    let body: BodyInit;
    if (isNativeAsset(asset)) {
      const fetched = await fetchWithUploadErrors(
        asset.uri,
        { signal: options.signal },
        networkLabel,
        options.abortedErrorLabel,
        options.signal,
      );
      body = await fetched.blob();
    } else {
      body = asset;
    }
    const res = await fetchWithUploadErrors(
      target.url,
      {
        method: 'PUT',
        headers: {
          'content-type': getAssetMimeType(asset),
          ...(target.headers ?? {}),
        },
        body,
        signal: options.signal,
      },
      networkLabel,
      options.abortedErrorLabel,
      options.signal,
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw createHttpUploadError(res.status, text, 'Direct storage upload failed');
    }
    options.onUploadProgress?.(85);
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url, true);

    const onAbort = () => xhr.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);

    if (xhr.upload) {
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          const pct = Math.min(85, Math.round((ev.loaded / ev.total) * 85));
          options.onUploadProgress?.(pct);
        }
      };
    }

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onUploadProgress?.(85);
        resolve();
      } else {
        reject(
          createHttpUploadError(
            xhr.status,
            xhr.responseText,
            'Direct storage upload failed',
          ),
        );
      }
    };

    xhr.onerror = () => {
      cleanup();
      reject(createNetworkUploadError(networkLabel));
    };

    xhr.onabort = () => {
      cleanup();
      reject(createUploadAbortError(options.abortedErrorLabel));
    };

    if (target.method === 'POST') {
      const fd = new FormData();
      if (target.fields) {
        for (const [k, v] of Object.entries(target.fields)) fd.append(k, v);
      }
      appendAssetToFormData(fd, 'file', asset);
      xhr.send(fd);
      return;
    }

    const headers = {
      'content-type': getAssetMimeType(asset),
      ...(target.headers ?? {}),
    };
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    if (isNativeAsset(asset)) {
      fetch(asset.uri, { signal: options.signal })
        .then((r) => r.blob())
        .then((blob) => xhr.send(blob))
        .catch((err) => {
          cleanup();
          reject(
            options.signal?.aborted || isUploadAbortError(err)
              ? createUploadAbortError(options.abortedErrorLabel)
              : createNetworkUploadError(networkLabel, err),
          );
        });
    } else {
      xhr.send(asset);
    }
  });
}

/**
 * Executes a two-phase presigned upload:
 * 1. `POST ${endpoint}?action=presign` -> receives `{ upload, token, expiresAt }`
 * 2. Direct `POST` or `PUT` of raw/resized bytes to storage (`0–85%` progress)
 * 3. `POST ${endpoint}?action=finalize` -> server downloads staged object, validates magic bytes,
 *    runs Sharp AVIF/WebP optimization + LQIP + variants, deletes staged object, and returns `UploadedImageData`.
 */
export async function uploadViaPresignedUrl(
  endpoint: string,
  asset: UploadableAsset,
  fields: UploadFormFields = {},
  options: XhrUploadOptions = {},
): Promise<UploadedImageData> {
  if (options.signal?.aborted) {
    throw createUploadAbortError(options.abortedErrorLabel);
  }
  const networkLabel =
    options.networkErrorLabel || 'Network error during image upload';

  const presignUrl = buildActionUrl(endpoint, 'presign');
  const presignRes = await fetchWithUploadErrors(
    presignUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      credentials: options.withCredentials ? 'include' : 'same-origin',
      signal: options.signal,
      body: JSON.stringify({
        filename: getAssetName(asset),
        contentType: getAssetMimeType(asset),
        size: getAssetSize(asset),
        ...fields,
      }),
    },
    networkLabel,
    options.abortedErrorLabel,
    options.signal,
  );

  const presignText = await presignRes.text();
  if (!presignRes.ok) {
    throw createHttpUploadError(
      presignRes.status,
      presignText,
      options.fallbackErrorLabel,
    );
  }

  let presignPayload: PresignResponsePayload;
  try {
    presignPayload = JSON.parse(presignText) as PresignResponsePayload;
  } catch {
    throw new UploadKitError(
      options.invalidResponseLabel || 'Invalid JSON response from presign endpoint',
      { code: 'PROCESSING_FAILED', status: presignRes.status || 502, retryable: false },
    );
  }

  await uploadDirectToStorageTarget(presignPayload.upload, asset, options);

  const finalizeUrl = buildActionUrl(endpoint, 'finalize');
  const finalizeRes = await fetchWithUploadErrors(
    finalizeUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      credentials: options.withCredentials ? 'include' : 'same-origin',
      signal: options.signal,
      body: JSON.stringify({
        token: presignPayload.token,
        altText: fields.altText,
        quality: fields.quality,
        outputFormat: fields.outputFormat,
        maxDimensions: fields.maxDimensions,
        aspectRatio: fields.aspectRatio,
        crop: fields.crop,
        customFilename: fields.customFilename,
        metadata: fields.metadata,
      }),
    },
    networkLabel,
    options.abortedErrorLabel,
    options.signal,
  );

  const finalizeText = await finalizeRes.text();
  if (!finalizeRes.ok) {
    throw createHttpUploadError(
      finalizeRes.status,
      finalizeText,
      options.fallbackErrorLabel,
    );
  }

  try {
    return JSON.parse(finalizeText) as UploadedImageData;
  } catch {
    throw new UploadKitError(
      options.invalidResponseLabel || 'Invalid JSON response from finalize endpoint',
      { code: 'PROCESSING_FAILED', status: finalizeRes.status || 502, retryable: false },
    );
  }
}
