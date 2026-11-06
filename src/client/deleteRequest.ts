import { createUploadAbortError, parseErrorPayload } from './xhrUpload';

export interface DeleteImageRequestOptions {
  headers?: Record<string, string>;
  withCredentials?: boolean;
  signal?: AbortSignal;
  fallbackErrorLabel?: string;
}

/**
 * Sends a `DELETE` request to `${deleteEndpoint}?url=${encodeURIComponent(url)}`
 * matching `createUploadHttpHandler`'s `DELETE` route contract.
 */
export async function deleteUploadedImage(
  deleteEndpoint: string,
  url: string,
  options: DeleteImageRequestOptions = {},
): Promise<void> {
  if (!deleteEndpoint || !url) return;
  if (options.signal?.aborted) {
    throw createUploadAbortError('Delete cancelled');
  }

  const separator = deleteEndpoint.includes('?') ? '&' : '?';
  const targetUrl = `${deleteEndpoint}${separator}url=${encodeURIComponent(url)}`;

  const response = await fetch(targetUrl, {
    method: 'DELETE',
    headers: options.headers,
    credentials: options.withCredentials ? 'include' : 'same-origin',
    signal: options.signal,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(
      parseErrorPayload(
        response.status,
        bodyText,
        options.fallbackErrorLabel ?? 'Delete failed',
      ),
    );
  }
}
