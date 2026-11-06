import type { ImageUploadAngularConfig } from './types';

export const IMAGE_UPLOAD_CONFIG_TOKEN = Symbol.for(
  'img-upload-kit.angular.config',
);

export const IMAGE_UPLOAD_CONFIG = IMAGE_UPLOAD_CONFIG_TOKEN;

export interface AngularValueProvider<T> {
  provide: typeof IMAGE_UPLOAD_CONFIG_TOKEN;
  useValue: T;
}

const DEFAULT_CONFIG: Required<
  Pick<
    ImageUploadAngularConfig,
    'endpoint' | 'locale' | 'storageKeyPrefix' | 'requireAltText' | 'unstyled'
  >
> = {
  endpoint: '/api/upload',
  locale: 'en',
  storageKeyPrefix: 'iuk',
  requireAltText: true,
  unstyled: false,
};

let activeConfig: ImageUploadAngularConfig = { ...DEFAULT_CONFIG };

function stripUndefined<T extends object>(obj?: T): Partial<T> {
  if (!obj) return {};
  const result: Partial<T> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

function normalizeConfig(
  base: ImageUploadAngularConfig,
  overrides?: Partial<ImageUploadAngularConfig>,
): ImageUploadAngularConfig {
  const cleanBase = stripUndefined(base);
  const cleanOverrides = stripUndefined(overrides);
  const merged: ImageUploadAngularConfig = {
    ...DEFAULT_CONFIG,
    ...cleanBase,
    ...cleanOverrides,
  };
  const resolvedUploader =
    cleanOverrides.customUploader ??
    cleanOverrides.uploader ??
    cleanBase.customUploader ??
    cleanBase.uploader;
  if (resolvedUploader) {
    merged.customUploader = resolvedUploader;
    merged.uploader = resolvedUploader;
  }
  return merged;
}

/**
 * Registers global upload configuration for Angular applications (`ApplicationConfig.providers`)
 * and sets the active configuration for standalone controllers (`createSingleUpload`, `createMultiUpload`).
 */
export function provideImageUploadConfig(
  config: ImageUploadAngularConfig,
): AngularValueProvider<ImageUploadAngularConfig> {
  activeConfig = normalizeConfig(DEFAULT_CONFIG, config);
  return {
    provide: IMAGE_UPLOAD_CONFIG_TOKEN,
    useValue: activeConfig,
  };
}

/**
 * Resolves the active `ImageUploadAngularConfig` merged with optional per-instance overrides.
 */
export function injectImageUploadConfig(
  overrides?: Partial<ImageUploadAngularConfig>,
): ImageUploadAngularConfig {
  return normalizeConfig(activeConfig, overrides);
}

/**
 * Alias for `injectImageUploadConfig` — resolves active Angular upload configuration
 * merged with optional per-instance overrides.
 */
export const resolveImageUploadConfig = injectImageUploadConfig;

/**
 * Resets the active Angular configuration back to defaults.
 */
export function resetImageUploadConfig(): void {
  activeConfig = { ...DEFAULT_CONFIG };
}
