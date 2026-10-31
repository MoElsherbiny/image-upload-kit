import { Type as TypeIcon } from 'lucide-react';
import { useId } from 'react';
import type { UploadLocale } from '../../types';
import { useImageUploadContext } from '../context';
import {
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';

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
}: AltTextInputProps) {
  const ctx = useImageUploadContext();
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(locale, translations || ctx.translations);
  const resolvedPlaceholder = placeholder || ui.describeImagePlaceholder;
  const resolvedLabel = label || ui.addImageDescription;
  const inputId = useId();
  const hintId = showHint ? `${inputId}-hint` : undefined;

  return (
    <div className="iuk-alt-input" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="iuk-alt-input__header">
        <TypeIcon size={16} />
        <label htmlFor={inputId} className="iuk-alt-input__label">
          {resolvedLabel}
        </label>
      </div>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={resolvedPlaceholder}
        className="iuk-alt-input__field"
        disabled={disabled}
        maxLength={maxLength}
        aria-label={ui.addAltTextAria}
        aria-describedby={hintId}
      />
      {showHint && (
        <p className="iuk-alt-input__hint" id={hintId}>
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
