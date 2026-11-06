import type {
  ExplicitOutputFormat,
  ImageDimensions,
  UploadedImageData,
} from '../../types';

export interface XhrUploadOptions {
  headers?: Record<string, string>;
  withCredentials?: boolean;
  signal?: AbortSignal;
  fallbackErrorLabel?: string;
  networkErrorLabel?: string;
  invalidResponseLabel?: string;
  abortedErrorLabel?: string;
  onUploadProgress?: (percent: number) => void;
}

export interface UploadFormFields {
  preset?: string;
  folder?: string;
  bucket?: string;
  altText?: string;
  customFilename?: string;
  outputFormat?: ExplicitOutputFormat;
  quality?: number;
  maxDimensions?: ImageDimensions;
  metadata?: Record<string, string>;
}

const MAX_ERROR_BODY_LENGTH = 160;

function sanitizeRawErrorBody(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return '';

  const looksLikeHtml =
    /<(?:!doctype|html|head|body|title|h[1-6]|p|div|span|center|hr)\b/i.test(
      trimmed,
    );

  let cleaned = trimmed;
  if (looksLikeHtml) {
    const titleMatch = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const h1Match = trimmed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const extracted = (h1Match?.[1] || titleMatch?.[1] || trimmed)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    cleaned = extracted;
  }

  if (cleaned.length > MAX_ERROR_BODY_LENGTH) {
    return `${cleaned.slice(0, MAX_ERROR_BODY_LENGTH).trimEnd()}…`;
  }
  return cleaned;
}

export function createUploadAbortError(message = 'Upload cancelled'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export function isUploadAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

export function parseErrorPayload(
  status: number,
  rawBody: string,
  fallbackLabel = 'Upload failed',
): string {
  const statusInfo = `status ${status}`;
  let parsed: Record<string, unknown> | undefined;
  try {
    const json = JSON.parse(rawBody);
    if (json && typeof json === 'object') {
      parsed = json as Record<string, unknown>;
    }
  } catch {
    parsed = undefined;
  }

  const candidateKeys = ['error', 'message', 'detail', 'details'] as const;
  if (parsed) {
    for (const key of candidateKeys) {
      const val = parsed[key];
      if (typeof val === 'string' && val.trim()) {
        return `${val.trim()} (${statusInfo})`;
      }
    }
  }

  const cleanedBody = rawBody ? sanitizeRawErrorBody(rawBody) : '';
  if (cleanedBody) {
    return `${cleanedBody} (${statusInfo})`;
  }

  return `${fallbackLabel} (${statusInfo})`;
}

export function buildUploadFormData(
  file: File | Blob,
  fields: UploadFormFields = {},
): FormData {
  const {
    preset,
    folder,
    bucket,
    altText,
    customFilename,
    outputFormat,
    quality,
    maxDimensions,
    metadata,
  } = fields;

  const formData = new FormData();
  formData.append('file', file);
  if (preset) formData.append('preset', preset);
  if (folder) formData.append('folder', folder);
  if (bucket) formData.append('bucket', bucket);
  if (altText) formData.append('altText', altText);
  if (customFilename) formData.append('customFilename', customFilename);
  if (outputFormat) formData.append('outputFormat', outputFormat);
  if (quality !== undefined) formData.append('quality', String(quality));
  if (maxDimensions) {
    formData.append('maxWidth', String(maxDimensions.width));
    formData.append('maxHeight', String(maxDimensions.height));
  }
  if (metadata && Object.keys(metadata).length > 0) {
    formData.append('metadata', JSON.stringify(metadata));
  }

  return formData;
}

export function uploadViaXhr(
  endpoint: string,
  formData: FormData,
  options: XhrUploadOptions = {},
): Promise<UploadedImageData> {
  const fallbackLabel = options.fallbackErrorLabel || 'Upload failed';
  const networkLabel =
    options.networkErrorLabel || 'Network error during image upload';
  const invalidJsonLabel =
    options.invalidResponseLabel ||
    'Invalid JSON response from upload endpoint';
  const abortedLabel = options.abortedErrorLabel || 'Upload cancelled';

  if (options.signal?.aborted) {
    return Promise.reject(createUploadAbortError(abortedLabel));
  }

  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(endpoint, {
      method: 'POST',
      body: formData,
      headers: options.headers,
      credentials: options.withCredentials ? 'include' : 'same-origin',
      signal: options.signal,
    }).then(async (res) => {
      const text = await res.text();
      if (!res.ok) {
        throw new Error(parseErrorPayload(res.status, text, fallbackLabel));
      }
      try {
        return JSON.parse(text) as UploadedImageData;
      } catch {
        throw new Error(invalidJsonLabel);
      }
    });
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    xhr.withCredentials = Boolean(options.withCredentials);

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        xhr.setRequestHeader(key, value);
      }
    }

    const onSignalAbort = () => {
      xhr.abort();
    };
    options.signal?.addEventListener('abort', onSignalAbort, { once: true });

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onSignalAbort);
    };

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.min(
          85,
          Math.round((event.loaded / event.total) * 85),
        );
        options.onUploadProgress?.(pct);
      }
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as UploadedImageData;
          resolve(parsed);
        } catch {
          reject(new Error(invalidJsonLabel));
        }
      } else {
        reject(
          new Error(
            parseErrorPayload(xhr.status, xhr.responseText, fallbackLabel),
          ),
        );
      }
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error(networkLabel));
    };

    xhr.onabort = () => {
      cleanup();
      reject(createUploadAbortError(abortedLabel));
    };

    xhr.send(formData);
  });
}
