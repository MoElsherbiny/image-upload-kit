import { UploadKitError } from '../../types/errors';
import { errorResponseFromKitError } from './responses';

export interface BoundedStreamBytesResult {
  bytes?: Uint8Array<ArrayBuffer>;
  errorResponse?: Response;
}

function payloadTooLargeResponse(message: string): Response {
  return errorResponseFromKitError(
    new UploadKitError(message, {
      code: 'FILE_TOO_LARGE',
      status: 413,
      retryable: false,
    }),
  );
}

/**
 * Reads a Web Fetch `Request` body into a bounded `Uint8Array`, cancelling the
 * underlying stream immediately if cumulative bytes exceed `maxBytes`.
 */
export async function readBoundedStreamBytes(
  request: Request,
  maxBytes: number,
  errorMessage?: string,
): Promise<BoundedStreamBytesResult> {
  const contentLengthRaw = request.headers.get('content-length');
  if (contentLengthRaw !== null && contentLengthRaw.trim() !== '') {
    const contentLength = Number(contentLengthRaw);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return {
        errorResponse: payloadTooLargeResponse(
          errorMessage ??
            `Payload too large: request body (${contentLength} bytes) exceeds limit of ${maxBytes} bytes`,
        ),
      };
    }
  }

  if (!request.body) {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      return {
        errorResponse: payloadTooLargeResponse(
          errorMessage ??
            `Payload too large: request body (${buf.byteLength} bytes) exceeds limit of ${maxBytes} bytes`,
        ),
      };
    }
    return { bytes: new Uint8Array(buf) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          return {
            errorResponse: payloadTooLargeResponse(
              errorMessage ??
                `Payload too large: streamed body exceeds limit of ${maxBytes} bytes`,
            ),
          };
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore release errors
    }
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: combined };
}

/**
 * Reads and parses a bounded JSON object body using streaming byte limits.
 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes = 16_384,
): Promise<{ body?: Record<string, unknown>; errorResponse?: Response }> {
  const invalidJson = () => ({
    errorResponse: errorResponseFromKitError(
      new UploadKitError('Invalid JSON request body', {
        code: 'INVALID_IMAGE',
        status: 400,
        retryable: false,
      }),
    ),
  });

  let bytes: Uint8Array | undefined;
  try {
    const res = await readBoundedStreamBytes(
      request,
      maxBytes,
      'Request body too large',
    );
    if (res.errorResponse) return { errorResponse: res.errorResponse };
    bytes = res.bytes;
  } catch {
    return invalidJson();
  }

  const rawText = bytes ? new TextDecoder().decode(bytes) : '';
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return invalidJson();
    }
    return { body: parsed as Record<string, unknown> };
  } catch {
    return invalidJson();
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
