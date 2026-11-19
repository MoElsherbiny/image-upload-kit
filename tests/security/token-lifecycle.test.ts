import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createImageUploader,
  createUploadHttpHandler,
  type PresignTokenPayload,
  type PresignTokenStore,
  signUploadToken,
  verifyUploadToken,
} from '../../src/server';
import { createMemoryStorageAdapter } from '../../src/storage';
import { isUploadKitError } from '../../src/types/errors';

const OLD_SECRET = 'old-rotation-secret-key-at-least-16-chars';
const NEW_SECRET = 'new-rotation-secret-key-at-least-16-chars';
const OTHER_SECRET = 'unrelated-secret-key-at-least-16-chars';

let pngBuffer: Buffer;

beforeAll(async () => {
  pngBuffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 120, b: 220 } },
  })
    .png()
    .toBuffer();
});

function makePayload(overrides: Partial<PresignTokenPayload> = {}): PresignTokenPayload {
  return {
    v: 1,
    jti: `jti-${Math.random().toString(36).slice(2)}`,
    exp: Date.now() + 60_000,
    bucket: 'media',
    path: '_staging/item.png',
    contentType: 'image/png',
    maxBytes: 1024 * 1024,
    ...overrides,
  };
}

function jsonReq(
  action: 'presign' | 'finalize',
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost/api/upload?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('Upload token lifecycle & security', () => {
  it('rejects expired tokens with UPLOAD_EXPIRED and respects clockToleranceMs', async () => {
    const baseNow = 1_700_000_000_000;
    const payload = makePayload({ exp: baseNow - 2_000 });
    const token = await signUploadToken(payload, NEW_SECRET);

    try {
      await verifyUploadToken(token, NEW_SECRET, { consume: false, now: baseNow });
      expect.unreachable('Expected expired token to throw');
    } catch (err) {
      expect(isUploadKitError(err)).toBe(true);
      if (isUploadKitError(err)) {
        expect(err.code).toBe('UPLOAD_EXPIRED');
      }
    }

    // Accepted within 5s clock tolerance
    const accepted = await verifyUploadToken(token, NEW_SECRET, {
      consume: false,
      now: baseNow,
      clockToleranceMs: 5_000,
    });
    expect(accepted.jti).toBe(payload.jti);

    // Rejected when skew exceeds tolerance
    await expect(
      verifyUploadToken(token, NEW_SECRET, {
        consume: false,
        now: baseNow + 4_000,
        clockToleranceMs: 5_000,
      }),
    ).rejects.toThrow(/expired/i);
  });

  it('rejects modified payload and invalid signatures with INVALID_UPLOAD_TOKEN', async () => {
    const payload = makePayload({ sub: 'user-a' });
    const token = await signUploadToken(payload, NEW_SECRET);
    const [, sig] = token.split('.');

    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...payload, sub: 'user-b' }),
    ).toString('base64url');
    const modifiedToken = `${tamperedPayload}.${sig}`;

    for (const bad of [modifiedToken, `${token}A`, 'not-a-valid-token', 'a.b.c']) {
      try {
        await verifyUploadToken(bad, NEW_SECRET, { consume: false });
        expect.unreachable('Expected invalid token to throw');
      } catch (err) {
        expect(isUploadKitError(err)).toBe(true);
        if (isUploadKitError(err)) {
          expect(err.code).toBe('INVALID_UPLOAD_TOKEN');
        }
      }
    }
  });

  it('supports secret rotation: signs with first secret and verifies against all secrets', async () => {
    const rotatedSecrets = [NEW_SECRET, OLD_SECRET] as const;

    const oldToken = await signUploadToken(makePayload(), OLD_SECRET);
    const newToken = await signUploadToken(makePayload(), rotatedSecrets);

    expect(
      (await verifyUploadToken(oldToken, rotatedSecrets, { consume: false })).v,
    ).toBe(1);
    expect(
      (await verifyUploadToken(newToken, rotatedSecrets, { consume: false })).v,
    ).toBe(1);
    // Token signed with rotation array uses first (NEW_SECRET), not OLD_SECRET
    expect(
      (await verifyUploadToken(newToken, NEW_SECRET, { consume: false })).v,
    ).toBe(1);
    await expect(
      verifyUploadToken(newToken, OLD_SECRET, { consume: false }),
    ).rejects.toThrow(/signature/i);
    await expect(
      verifyUploadToken(oldToken, [NEW_SECRET, OTHER_SECRET], { consume: false }),
    ).rejects.toThrow(/signature/i);
  });

  it('blocks replayed tokens and concurrent same-token finalize races atomically', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    const seen = new Set<string>();
    const tokenStore: PresignTokenStore = {
      consume(jti) {
        if (seen.has(jti)) return false;
        seen.add(jti);
        return true;
      },
    };
    const handler = createUploadHttpHandler({
      uploader,
      presigned: { secret: NEW_SECRET, tokenStore },
    });

    const presignRes = await handler.POST(
      jsonReq('presign', { filename: 'race.png', contentType: 'image/png', size: pngBuffer.byteLength }),
    );
    const presigned = (await presignRes.json()) as { token: string; bucket: string; path: string };
    await storage.putPresigned(presigned.bucket, presigned.path, pngBuffer, 'image/png');

    const results = await Promise.all([
      handler.POST(jsonReq('finalize', { token: presigned.token })),
      handler.POST(jsonReq('finalize', { token: presigned.token })),
      handler.POST(jsonReq('finalize', { token: presigned.token })),
    ]);

    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409, 409]);

    const replay = await handler.POST(jsonReq('finalize', { token: presigned.token }));
    expect(replay.status).toBe(409);
  });

  it('prevents unauthorized or cross-user callers from burning a victim single-use token', async () => {
    const storage = createMemoryStorageAdapter();
    const uploader = createImageUploader({ storage, defaultBucket: 'media' });
    const handler = createUploadHttpHandler({
      uploader,
      authorize: ({ request }) => Boolean(request.headers.get('x-user-id')),
      getSubject: ({ request }) => request.headers.get('x-user-id') ?? undefined,
      presigned: { secret: [NEW_SECRET, OLD_SECRET] },
    });

    // Victim presigns
    const presignRes = await handler.POST(
      jsonReq(
        'presign',
        { filename: 'victim.png', contentType: 'image/png', size: pngBuffer.byteLength },
        { 'x-user-id': 'user-victim' },
      ),
    );
    expect(presignRes.status).toBe(200);
    const presigned = (await presignRes.json()) as {
      token: string;
      bucket: string;
      path: string;
    };
    await storage.putPresigned(presigned.bucket, presigned.path, pngBuffer, 'image/png');

    // 1. Unauthenticated attacker attempts finalize -> 401, must NOT burn token
    const unauthRes = await handler.POST(jsonReq('finalize', { token: presigned.token }));
    expect(unauthRes.status).toBe(401);

    // 2. Different authenticated user attempts finalize -> 403 FORBIDDEN, must NOT burn token
    const wrongUserRes = await handler.POST(
      jsonReq('finalize', { token: presigned.token }, { 'x-user-id': 'user-attacker' }),
    );
    expect(wrongUserRes.status).toBe(403);
    const wrongUserBody = (await wrongUserRes.json()) as { code: string; error: string };
    expect(wrongUserBody.code).toBe('FORBIDDEN');

    // 3. Victim finalizes with their own token -> 200 succeeds!
    const victimRes = await handler.POST(
      jsonReq('finalize', { token: presigned.token }, { 'x-user-id': 'user-victim' }),
    );
    expect(victimRes.status).toBe(200);

    // 4. Subsequent replay by victim is now rejected -> 409
    const replayRes = await handler.POST(
      jsonReq('finalize', { token: presigned.token }, { 'x-user-id': 'user-victim' }),
    );
    expect(replayRes.status).toBe(409);
  });
});
