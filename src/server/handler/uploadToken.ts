import { UploadValidationError } from './responses';

export interface PresignTokenStore {
  /** Atomically marks `jti` as consumed until `expMs`. Returns `true` if newly consumed, or `false` if already consumed. */
  consume(jti: string, expMs: number): Promise<boolean> | boolean;
}

export interface PresignTokenPayload {
  v: 1;
  jti: string;
  exp: number;
  bucket: string;
  path: string;
  contentType: string;
  maxBytes: number;
  targetBucket?: string;
  sub?: string;
  preset?: string;
  folder?: string;
  originalName?: string;
}

export interface VerifyUploadTokenOptions {
  consume?: boolean;
  tokenStore?: PresignTokenStore;
}

const MIN_SECRET_LENGTH = 16;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_CONSUMED_TOKENS = 4096;
const consumedTokens = new Map<string, number>();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(str.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function computeHmacSha256(
  data: string,
  secret: string,
): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(data),
  );
  return new Uint8Array(sig);
}

function pruneExpiredConsumedTokens(now = Date.now()): void {
  for (const [jti, exp] of consumedTokens) {
    if (exp <= now) {
      consumedTokens.delete(jti);
    }
  }
}

function consumeInMemoryToken(jti: string, expMs: number): boolean {
  const now = Date.now();
  pruneExpiredConsumedTokens(now);
  const existingExp = consumedTokens.get(jti);
  if (existingExp !== undefined && existingExp > now) {
    return false;
  }
  if (consumedTokens.has(jti)) {
    consumedTokens.delete(jti);
  } else if (consumedTokens.size >= MAX_CONSUMED_TOKENS) {
    const oldest = consumedTokens.keys().next().value;
    if (oldest !== undefined) consumedTokens.delete(oldest);
  }
  consumedTokens.set(jti, expMs > now ? expMs : now + 300_000);
  return true;
}

/**
 * Signs a stateless `PresignTokenPayload` using WebCrypto HMAC-SHA256.
 */
export async function signUploadToken(
  payload: PresignTokenPayload,
  secret: string,
): Promise<string> {
  if (typeof secret !== 'string' || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error('Presigned upload token secret must be at least 16 characters');
  }
  const json = JSON.stringify(payload);
  const payloadB64 = toBase64Url(textEncoder.encode(json));
  const sigBytes = await computeHmacSha256(payloadB64, secret);
  const sigB64 = toBase64Url(sigBytes);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies an HMAC-SHA256 upload token in constant time, checks expiration,
 * and atomically consumes the token `jti` (unless `options.consume === false`).
 */
export async function verifyUploadToken(
  token: string,
  secret: string,
  options?: VerifyUploadTokenOptions,
): Promise<PresignTokenPayload> {
  if (!token || typeof token !== 'string') {
    throw new UploadValidationError('Invalid upload token');
  }
  if (typeof secret !== 'string' || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new UploadValidationError(
      'Presigned upload token secret must be at least 16 characters',
    );
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new UploadValidationError('Malformed upload token');
  }

  const [payloadB64, sigB64] = parts;
  let actualSig: Uint8Array;
  try {
    actualSig = fromBase64Url(sigB64);
  } catch {
    throw new UploadValidationError('Invalid upload token encoding');
  }

  const expectedSig = await computeHmacSha256(payloadB64, secret);
  if (!constantTimeEqual(expectedSig, actualSig)) {
    throw new UploadValidationError('Invalid upload token signature');
  }

  let parsed: unknown;
  try {
    const jsonBytes = fromBase64Url(payloadB64);
    parsed = JSON.parse(textDecoder.decode(jsonBytes));
  } catch {
    throw new UploadValidationError('Invalid upload token payload');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new UploadValidationError('Invalid upload token payload');
  }

  const payload = parsed as PresignTokenPayload;
  if (
    payload.v !== 1 ||
    typeof payload.jti !== 'string' ||
    !payload.jti ||
    typeof payload.exp !== 'number' ||
    typeof payload.bucket !== 'string' ||
    !payload.bucket ||
    typeof payload.path !== 'string' ||
    !payload.path ||
    typeof payload.contentType !== 'string' ||
    !payload.contentType ||
    typeof payload.maxBytes !== 'number' ||
    payload.maxBytes <= 0
  ) {
    throw new UploadValidationError('Invalid upload token claims');
  }

  if (Date.now() >= payload.exp) {
    throw new UploadValidationError('Upload token has expired');
  }

  if (options?.consume !== false) {
    const newlyConsumed = options?.tokenStore
      ? await options.tokenStore.consume(payload.jti, payload.exp)
      : consumeInMemoryToken(payload.jti, payload.exp);
    if (!newlyConsumed) {
      const err = new Error('Upload token has already been used') as Error & {
        status?: number;
      };
      err.status = 409;
      throw err;
    }
  }

  return payload;
}
