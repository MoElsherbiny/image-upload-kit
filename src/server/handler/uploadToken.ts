import { UploadValidationError } from './responses';

export type UploadTokenSecret = string | readonly string[];

export interface PresignTokenStore {
  /** Atomically marks `jti` as consumed until `expMs`. Returns `true` if newly consumed, or `false` if already consumed. */
  consume(jti: string, expMs: number): Promise<boolean> | boolean;
  /** Optional: unmarks `jti` after a retryable finalize failure so the client can retry before token expiry. */
  release?(jti: string): Promise<void> | void;
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
  /** Clock skew tolerance in milliseconds when checking token expiry (default `0`). */
  clockToleranceMs?: number;
  /** Optional current timestamp in ms for deterministic testing (default `Date.now()`). */
  now?: number;
}

const MIN_SECRET_LENGTH = 16;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_CONSUMED_TOKENS = 4096;
const consumedTokens = new Map<string, number>();

function normalizeSecrets(
  secret: UploadTokenSecret,
  asValidationError: boolean,
): string[] {
  const list = Array.isArray(secret) ? secret : [secret];
  if (
    list.length === 0 ||
    list.some(
      (s) => typeof s !== 'string' || s.trim().length < MIN_SECRET_LENGTH,
    )
  ) {
    const message =
      'Presigned upload token secret must be at least 16 characters';
    if (asValidationError) {
      throw new UploadValidationError(message, {
        code: 'INVALID_UPLOAD_TOKEN',
      });
    }
    throw new Error(message);
  }
  return list as string[];
}

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
 * Atomically marks a verified token `jti` as consumed.
 * Throws a 409 `UploadValidationError` (`INVALID_UPLOAD_TOKEN`) if already consumed.
 */
export async function consumeUploadToken(
  jti: string,
  expMs: number,
  tokenStore?: PresignTokenStore,
): Promise<void> {
  const newlyConsumed = tokenStore
    ? await tokenStore.consume(jti, expMs)
    : consumeInMemoryToken(jti, expMs);
  if (!newlyConsumed) {
    throw new UploadValidationError('Upload token has already been used', {
      code: 'INVALID_UPLOAD_TOKEN',
      status: 409,
    });
  }
}

/** Releases a previously consumed token `jti` so `finalize` can be retried after a retryable error. */
export async function releaseUploadToken(
  jti: string,
  tokenStore?: PresignTokenStore,
): Promise<void> {
  if (tokenStore) {
    await tokenStore.release?.(jti);
  } else {
    consumedTokens.delete(jti);
  }
}

/**
 * Signs a stateless `PresignTokenPayload` using WebCrypto HMAC-SHA256.
 * When `secret` is an array (rotation), signs with the first (active) secret.
 */
export async function signUploadToken(
  payload: PresignTokenPayload,
  secret: UploadTokenSecret,
): Promise<string> {
  const [activeSecret] = normalizeSecrets(secret, false);
  const json = JSON.stringify(payload);
  const payloadB64 = toBase64Url(textEncoder.encode(json));
  const sigBytes = await computeHmacSha256(payloadB64, activeSecret);
  const sigB64 = toBase64Url(sigBytes);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies an HMAC-SHA256 upload token in constant time across all configured secrets,
 * checks expiration (respecting `clockToleranceMs`), and atomically consumes the token `jti`
 * unless `options.consume === false`.
 */
export async function verifyUploadToken(
  token: string,
  secret: UploadTokenSecret,
  options?: VerifyUploadTokenOptions,
): Promise<PresignTokenPayload> {
  if (!token || typeof token !== 'string') {
    throw new UploadValidationError('Invalid upload token', { code: 'INVALID_UPLOAD_TOKEN' });
  }
  const secrets = normalizeSecrets(secret, true);

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new UploadValidationError('Malformed upload token', { code: 'INVALID_UPLOAD_TOKEN' });
  }

  const [payloadB64, sigB64] = parts;
  let actualSig: Uint8Array;
  try {
    actualSig = fromBase64Url(sigB64);
  } catch {
    throw new UploadValidationError('Invalid upload token encoding', { code: 'INVALID_UPLOAD_TOKEN' });
  }

  let signatureValid = false;
  for (const candidate of secrets) {
    const expectedSig = await computeHmacSha256(payloadB64, candidate);
    if (constantTimeEqual(expectedSig, actualSig)) signatureValid = true;
  }
  if (!signatureValid) {
    throw new UploadValidationError('Invalid upload token signature', { code: 'INVALID_UPLOAD_TOKEN' });
  }

  let parsed: unknown;
  try {
    const jsonBytes = fromBase64Url(payloadB64);
    parsed = JSON.parse(textDecoder.decode(jsonBytes));
  } catch {
    throw new UploadValidationError('Invalid upload token payload', { code: 'INVALID_UPLOAD_TOKEN' });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UploadValidationError('Invalid upload token payload', {
      code: 'INVALID_UPLOAD_TOKEN',
    });
  }

  const payload = parsed as PresignTokenPayload;
  if (
    payload.v !== 1 ||
    typeof payload.jti !== 'string' ||
    !payload.jti ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    typeof payload.bucket !== 'string' ||
    !payload.bucket ||
    typeof payload.path !== 'string' ||
    !payload.path ||
    typeof payload.contentType !== 'string' ||
    !payload.contentType ||
    typeof payload.maxBytes !== 'number' ||
    !Number.isFinite(payload.maxBytes) ||
    payload.maxBytes <= 0 ||
    (payload.sub !== undefined &&
      (typeof payload.sub !== 'string' || !payload.sub.trim()))
  ) {
    throw new UploadValidationError('Invalid upload token claims', {
      code: 'INVALID_UPLOAD_TOKEN',
    });
  }

  const rawTolerance = options?.clockToleranceMs ?? 0;
  const clockToleranceMs =
    typeof rawTolerance === 'number' &&
    Number.isFinite(rawTolerance) &&
    rawTolerance > 0
      ? rawTolerance
      : 0;
  const now = options?.now ?? Date.now();
  if (now >= payload.exp + clockToleranceMs) {
    throw new UploadValidationError('Upload token has expired', {
      code: 'UPLOAD_EXPIRED',
    });
  }

  if (options?.consume !== false) {
    await consumeUploadToken(payload.jti, payload.exp, options?.tokenStore);
  }

  return payload;
}
