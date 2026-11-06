import {
  type App,
  getCurrentInstance,
  type InjectionKey,
  inject,
  type ObjectPlugin,
  provide,
} from 'vue';
import type { ImageUploadVueConfig } from './types';

export const IMAGE_UPLOAD_CONFIG_KEY: InjectionKey<ImageUploadVueConfig> =
  Symbol.for('img-upload-kit.vue.config') as InjectionKey<ImageUploadVueConfig>;

const DEFAULT_CONFIG: Required<
  Pick<
    ImageUploadVueConfig,
    | 'endpoint'
    | 'locale'
    | 'uploadMode'
    | 'storageKeyPrefix'
    | 'requireAltText'
    | 'unstyled'
  >
> = {
  endpoint: '/api/upload',
  locale: 'en',
  uploadMode: 'direct',
  storageKeyPrefix: 'iuk',
  requireAltText: false,
  unstyled: false,
};

let activeConfig: ImageUploadVueConfig = { ...DEFAULT_CONFIG };

function stripUndefined<T extends Record<string, unknown>>(obj?: T): Partial<T> {
  if (!obj) return {};
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function normalizeConfig(
  base: ImageUploadVueConfig,
  overrides?: Partial<ImageUploadVueConfig>,
): ImageUploadVueConfig {
  const cleanBase = stripUndefined(base as Record<string, unknown>);
  const cleanOverrides = stripUndefined(overrides as Record<string, unknown>);
  const merged: ImageUploadVueConfig = {
    ...DEFAULT_CONFIG,
    ...cleanBase,
    ...cleanOverrides,
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
 * Updates the module-level fallback `ImageUploadVueConfig` used when composables
 * are invoked outside a Vue component tree.
 */
export function setDefaultImageUploadConfig(
  config: ImageUploadVueConfig,
): ImageUploadVueConfig {
  const resolved = normalizeConfig(DEFAULT_CONFIG, config);
  activeConfig = resolved;
  return resolved;
}

/**
 * Provides `ImageUploadVueConfig` inside a Vue component `setup()` context
 * (via `provide(IMAGE_UPLOAD_CONFIG_KEY, ...)`) without mutating module state,
 * or updates the fallback default config when called outside a component instance.
 */
export function provideImageUploadConfig(
  config: ImageUploadVueConfig,
): ImageUploadVueConfig {
  const resolved = normalizeConfig(DEFAULT_CONFIG, config);
  if (getCurrentInstance()) {
    provide(IMAGE_UPLOAD_CONFIG_KEY, resolved);
  } else {
    activeConfig = resolved;
  }
  return resolved;
}

export const provideImageUpload = provideImageUploadConfig;

/**
 * Resolves the active `ImageUploadVueConfig` from Vue's dependency injection tree
 * (when inside `setup()`) or the module-level fallback config, merged with optional overrides.
 */
export function useImageUploadConfig(
  overrides?: Partial<ImageUploadVueConfig>,
  baseConfig?: ImageUploadVueConfig,
): ImageUploadVueConfig {
  const injected =
    baseConfig ??
    (getCurrentInstance()
      ? inject(IMAGE_UPLOAD_CONFIG_KEY, activeConfig)
      : activeConfig);
  return normalizeConfig(injected, overrides);
}

/**
 * Creates a Vue 3 plugin (`app.use(createImageUpload(config))`) that registers
 * `IMAGE_UPLOAD_CONFIG_KEY` at the application root without mutating module state.
 */
export function createImageUpload(
  config: ImageUploadVueConfig = {},
): ObjectPlugin<[ImageUploadVueConfig?]> {
  return {
    install(app: App, installOverrides?: ImageUploadVueConfig) {
      const resolved = normalizeConfig(DEFAULT_CONFIG, {
        ...config,
        ...stripUndefined(installOverrides as Record<string, unknown>),
      });
      app.provide(IMAGE_UPLOAD_CONFIG_KEY, resolved);
    },
  };
}

/**
 * Resets the fallback Vue configuration back to defaults (useful in test suites).
 */
export function resetImageUploadConfig(): void {
  activeConfig = { ...DEFAULT_CONFIG };
}
