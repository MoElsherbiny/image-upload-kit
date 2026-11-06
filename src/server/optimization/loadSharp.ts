/**
 * Lazy loaders for the optional native peer dependencies (`sharp`,
 * `lqip-modern`). They are resolved on first use via dynamic `import()` so
 * that merely importing `img-upload-kit/server` (or bundling it) never
 * requires the native binaries to be present, and so that missing peers
 * produce an actionable error instead of an opaque module-resolution crash.
 */
import type LqipDefault from 'lqip-modern';
import type SharpDefault from 'sharp';

export type SharpFactory = typeof SharpDefault;
export type LqipFn = typeof LqipDefault;

export const SHARP_MISSING_MESSAGE =
  'img-upload-kit/server requires `sharp` — run `npm i sharp`';
export const LQIP_MISSING_MESSAGE =
  'img-upload-kit/server requires `lqip-modern` for LQIP generation — run `npm i lqip-modern`';

let sharpPromise: Promise<SharpFactory> | null = null;
let lqipPromise: Promise<LqipFn> | null = null;

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

/** Resolves the `lqip-modern` function, throwing a descriptive error if it is not installed. */
export function loadLqip(): Promise<LqipFn> {
  if (!lqipPromise) {
    lqipPromise = import('lqip-modern').then(
      (mod) => unwrapDefault<LqipFn>(mod),
      (error: unknown) => {
        lqipPromise = null;
        throw new Error(LQIP_MISSING_MESSAGE, { cause: error });
      },
    );
  }
  return lqipPromise;
}
