import type { UploadLocale } from '../types';
import { arTranslations } from './i18n/ar';
import { enTranslations } from './i18n/en';
import type {
  BlurModalTranslations,
  UploadTranslations,
} from './i18n/types';

export { arTranslations, enTranslations };
export type { BlurModalTranslations, UploadTranslations };

export function normalizeUploadLocale(locale?: string): UploadLocale {
  if (locale && locale.toLowerCase().startsWith('ar')) {
    return 'ar';
  }
  if (typeof document !== 'undefined') {
    const docLang =
      document.documentElement.getAttribute('lang') ||
      document.documentElement.getAttribute('dir');
    if (!locale && (docLang === 'ar' || docLang === 'rtl')) {
      return 'ar';
    }
  }
  return 'en';
}

export const uploadText: Record<UploadLocale, UploadTranslations> = {
  en: enTranslations,
  ar: arTranslations,
};

export function resolveTranslations(
  locale?: UploadLocale,
  overrides?: Partial<UploadTranslations>,
): UploadTranslations {
  const base = uploadText[normalizeUploadLocale(locale)];
  if (!overrides) return base;
  return {
    ...base,
    ...overrides,
    blurModal: {
      ...base.blurModal,
      ...(overrides.blurModal || {}),
    },
  };
}
