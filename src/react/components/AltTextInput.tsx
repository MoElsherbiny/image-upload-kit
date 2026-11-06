import { TypeIcon } from '../icons';
import { useId } from 'react';
import type { UploadLocale } from '../../types';
import { useImageUploadContext } from '../context';
import {
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';
import { resolveSlotClass } from '../utils/slotStyles';

export interface AltTextInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  label?: string;
  showHint?: boolean;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  unstyled?: boolean;
}

export function AltTextInput({
  value,
  onChange,
  disabled = false,
  placeholder,
  maxLength = 200,
  label,
  showHint = true,
  locale: propLocale,
  translations,
  unstyled: propUnstyled,
}: AltTextInputProps) {
  const ctx = useImageUploadContext();
  const isUnstyled = propUnstyled ?? ctx.unstyled;
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(locale, translations || ctx.translations);
  const resolvedPlaceholder = placeholder || ui.describeImagePlaceholder;
  const resolvedLabel = label || ui.addImageDescription;
  const inputId = useId();
  const hintId = showHint ? `${inputId}-hint` : undefined;
  const cls = (defaultClass: string) => resolveSlotClass(defaultClass, isUnstyled);

  return (
    <div
      data-slot="alt-input"
      data-unstyled={isUnstyled || undefined}
      className={cls('iuk-alt-input')}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className={cls('iuk-alt-input__header')}>
        <TypeIcon size={16} />
        <label htmlFor={inputId} className={cls('iuk-alt-input__label')}>
          {resolvedLabel}
        </label>
      </div>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={resolvedPlaceholder}
        className={cls('iuk-alt-input__field')}
        disabled={disabled}
        maxLength={maxLength}
        aria-describedby={hintId}
      />
      {showHint && (
        <p className={cls('iuk-alt-input__hint')} id={hintId}>
          <span>
            {value.length}/{maxLength} {ui.characters}
          </span>
          <span>{ui.usedForA11ySeo}</span>
        </p>
      )}
    </div>
  );
}

export default AltTextInput;
