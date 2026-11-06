import type { UploadLocale } from '../types';
import { arTranslations } from './i18n/ar';
import { enTranslations } from './i18n/en';
import type {
  BlurModalTranslations,
  UploadTranslations,
} from './i18n/types';

export { arTranslations, enTranslations };
export const DEFAULT_UPLOAD_TRANSLATIONS = enTranslations;
export const ARABIC_UPLOAD_TRANSLATIONS = arTranslations;
export type { BlurModalTranslations, UploadLocale, UploadTranslations };

export function normalizeUploadLocale(locale?: string): UploadLocale {
  if (locale) {
    return locale.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  }
  if (typeof document !== 'undefined') {
    const docLang =
      document.documentElement.getAttribute('lang')?.toLowerCase() || '';
    const docDir =
      document.documentElement.getAttribute('dir')?.toLowerCase() || '';
    if (docLang.startsWith('ar') || docDir === 'rtl') {
      return 'ar';
    }
  }
  return 'en';
}

export function selectPluralCategory(
  locale: UploadLocale,
  count: number,
): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale).select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

export function formatUploadingCount(
  ui: UploadTranslations,
  count: number,
  locale: UploadLocale,
  overrides?: Partial<UploadTranslations>,
): string {
  if (
    overrides &&
    !overrides.uploadingCount &&
    (overrides.uploading || overrides.uploadImage || overrides.uploadImages)
  ) {
    const isOne = selectPluralCategory(locale, count) === 'one';
    return `${ui.uploading} ${count} ${isOne ? ui.uploadImage : ui.uploadImages}`;
  }
  const suffix = selectPluralCategory(locale, count) === 'one' ? '' : 's';
  return ui.uploadingCount
    .replace('{count}', String(count))
    .replace('{suffix}', suffix);
}

export function formatNeedsAltMessage(
  ui: UploadTranslations,
  count: number,
  locale: UploadLocale,
): string {
  const isOne = selectPluralCategory(locale, count) === 'one';
  return ui.needsAltBeforeSave
    .replace('{count}', String(count))
    .replace('{suffix}', isOne ? '' : 's')
    .replace('{verbSuffix}', isOne ? 's' : '');
}

export function formatSkippedImagesMessage(
  ui: UploadTranslations,
  imageCount: number,
  skippedCount: number,
  locale: UploadLocale,
): string {
  const imgSuffix =
    selectPluralCategory(locale, imageCount) === 'one' ? '' : 's';
  const skipSuffix =
    selectPluralCategory(locale, skippedCount) === 'one' ? '' : 's';
  return ui.selectedImagesSkipped
    .replace('{imageCount}', String(imageCount))
    .replace('{imageSuffix}', imgSuffix)
    .replace('{skippedCount}', String(skippedCount))
    .replace('{skippedSuffix}', skipSuffix);
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
