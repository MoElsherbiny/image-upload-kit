import type {
  ExplicitOutputFormat,
  ImageDimensions,
  UploadedImageData,
} from '../../types';

export interface XhrUploadOptions {
  headers?: Record<string, string>;
  withCredentials?: boolean;
  fallbackErrorLabel?: string;
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

  if (rawBody && rawBody.trim()) {
    return `${rawBody.trim()} (${statusInfo})`;
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

  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(endpoint, {
      method: 'POST',
      body: formData,
      headers: options.headers,
      credentials: options.withCredentials ? 'include' : 'same-origin',
    }).then(async (res) => {
      const text = await res.text();
      if (!res.ok) {
        throw new Error(parseErrorPayload(res.status, text, fallbackLabel));
      }
      return JSON.parse(text) as UploadedImageData;
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
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as UploadedImageData;
          resolve(parsed);
        } catch {
          reject(new Error('Invalid JSON response from upload endpoint'));
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
      reject(new Error('Network error during image upload'));
    };

    xhr.send(formData);
  });
}
