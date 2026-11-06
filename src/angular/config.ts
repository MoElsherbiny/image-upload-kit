import type { ImageUploadAngularConfig } from './types';

export const IMAGE_UPLOAD_CONFIG_TOKEN = Symbol.for(
  'img-upload-kit.angular.config',
);

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

function normalizeConfig(
  base: ImageUploadAngularConfig,
  overrides?: Partial<ImageUploadAngularConfig>,
): ImageUploadAngularConfig {
  const merged: ImageUploadAngularConfig = {
    ...DEFAULT_CONFIG,
    ...base,
    ...overrides,
  };
  const resolvedUploader =
    overrides?.customUploader ??
    overrides?.uploader ??
    base.customUploader ??
    base.uploader;
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
 * Resets the active Angular configuration back to defaults.
 */
export function resetImageUploadConfig(): void {
  activeConfig = { ...DEFAULT_CONFIG };
}
