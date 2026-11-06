/**
 * Lazy loader for the optional native peer dependency (`sharp`).
 * Resolved on first use via dynamic `import()` so that merely importing
 * `img-upload-kit/server` (or bundling it) never requires the native binary
 * to be present, and so that a missing peer produces an actionable error
 * instead of an opaque module-resolution crash.
 */
import type SharpDefault from 'sharp';

export type SharpFactory = typeof SharpDefault;
export type LqipFn = (input: Buffer | string) => Promise<unknown>;

export const SHARP_MISSING_MESSAGE =
  'img-upload-kit/server requires `sharp` - run `npm i sharp`';

/**
 * @deprecated `lqip-modern` is no longer required; LQIP placeholders are generated directly with `sharp`.
 */
export const LQIP_MISSING_MESSAGE =
  'lqip-modern is no longer used by img-upload-kit; LQIP is generated directly via `sharp`';

let sharpPromise: Promise<SharpFactory> | null = null;

function unwrapDefault<T>(mod: unknown): T {
  const record = mod as { default?: unknown };
  return (record && record.default !== undefined ? record.default : mod) as T;
}

/** Resolves the `sharp` factory, throwing a descriptive error if it is not installed. */
export function loadSharp(): Promise<SharpFactory> {
  if (!sharpPromise) {
    sharpPromise = import('sharp').then(
      (mod) => unwrapDefault<SharpFactory>(mod),
      (error: unknown) => {
        sharpPromise = null;
        throw new Error(SHARP_MISSING_MESSAGE, { cause: error });
      },
    );
  }
  return sharpPromise;
}

/**
 * @deprecated `lqip-modern` is no longer used; LQIP placeholders are generated directly with `sharp`.
 */
export function loadLqip(): Promise<LqipFn> {
  return Promise.reject(new Error(LQIP_MISSING_MESSAGE));
}
