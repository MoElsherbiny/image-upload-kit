import { CheckIcon as Check, InfoIcon as Info, ZapIcon as Zap } from '../icons';
import type { KeyboardEvent } from 'react';
import type {
  QualityLevel,
  StandardPresetName,
  UploadLocale,
} from '../../types';
import { QUALITY_PRESETS, STANDARD_PRESETS } from '../../types';
import { estimateOutputSize } from '../../utils/formatters';
import {
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';
import { cx, resolveSlotClass } from '../utils/slotStyles';

function formatBytesCompact(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface QualitySelectorProps {
  value: QualityLevel;
  onChange: (level: QualityLevel) => void;
  preset?: string;
  recommendedLevel?: QualityLevel;
  recommendationNote?: { en: string; ar?: string };
  originalFileSize?: number;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  disabled?: boolean;
  unstyled?: boolean;
}

export function QualitySelector({
  value,
  onChange,
  preset,
  recommendedLevel,
  recommendationNote,
  originalFileSize,
  locale,
  translations,
  disabled = false,
  unstyled = false,
}: QualitySelectorProps) {
  const resolvedLocale = normalizeUploadLocale(locale);
  const isAr = resolvedLocale === 'ar';
  const ui = resolveTranslations(resolvedLocale, translations);
  const cls = (defaultClass: string) => resolveSlotClass(defaultClass, unstyled);

  const standardPreset = preset
    ? STANDARD_PRESETS[preset as StandardPresetName]
    : undefined;

  const recommended: QualityLevel =
    recommendedLevel || standardPreset?.recommendedQualityLevel || 'high';
  const note = recommendationNote || standardPreset?.recommendationNote;

  const selected = QUALITY_PRESETS[value];
  const levels = Object.keys(QUALITY_PRESETS) as QualityLevel[];
  const estimatedSize =
    originalFileSize !== undefined
      ? estimateOutputSize(originalFileSize, value)
      : null;
  const saving = Math.round((1 - selected.compressionRatio) * 100);

  const handleRadioGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const currentIndex = Math.max(0, levels.indexOf(value));
    let nextIndex = -1;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      const step = event.key === 'ArrowRight' && isAr ? -1 : 1;
      nextIndex = (currentIndex + step + levels.length) % levels.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowLeft' && isAr ? 1 : -1;
      nextIndex = (currentIndex + step + levels.length) % levels.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = levels.length - 1;
    }

    if (nextIndex >= 0) {
      event.preventDefault();
      const nextLevel = levels[nextIndex];
      onChange(nextLevel);
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons[nextIndex]?.focus();
    }
  };

  return (
    <div
      data-slot="quality-root"
      data-unstyled={unstyled || undefined}
      className={cls('iuk-quality')}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className={cls('iuk-quality__header')}>
        <span className={cls('iuk-quality__title')}>
          {ui.qualityTitle}
        </span>
        <span className={cls(`iuk-quality__pill iuk-quality__pill--${value}`)}>
          {isAr ? selected.labelAr : selected.label} · Q{selected.value}
        </span>
      </div>

      <div
        className={cls('iuk-quality__tabs')}
        role="radiogroup"
        aria-label={ui.qualityLevelAria}
        onKeyDown={handleRadioGroupKeyDown}
      >
        {levels.map((level) => {
          const item = QUALITY_PRESETS[level];
          const isSelected = value === level;
          const isRecommended = level === recommended;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={disabled ? -1 : isSelected ? 0 : -1}
              disabled={disabled}
              onClick={() => !disabled && onChange(level)}
              className={cls(
                cx(
                  'iuk-quality__tab',
                  isSelected && 'iuk-quality__tab--selected',
                  isRecommended && !isSelected && 'iuk-quality__tab--recommended',
                  disabled && 'iuk-quality__tab--disabled',
                ),
              )}
            >
              {isSelected && (
                <Check size={11} strokeWidth={3} aria-hidden="true" />
              )}
              <span>{isAr ? item.labelAr : item.label}</span>
              {isRecommended && !isSelected && (
                <span className={cls('iuk-quality__star')} aria-hidden="true">
                  ★
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className={cls(`iuk-quality__detail iuk-quality__detail--${value}`)}>
        <p className={cls('iuk-quality__desc')}>
          {isAr ? selected.descriptionAr : selected.description}
        </p>
        <div className={cls('iuk-quality__meta')}>
          <span className={cls('iuk-quality__tag')}>Q{selected.value}</span>
          {estimatedSize !== null && (
            <>
              <span className={cls('iuk-quality__dot')} aria-hidden="true" />
              <Zap size={11} aria-hidden="true" />
              <span>~{formatBytesCompact(estimatedSize)}</span>
              <span className={cls('iuk-quality__dot')} aria-hidden="true" />
              <span className={cls('iuk-quality__saving')}>
                {saving}% {ui.qualitySaved}
              </span>
            </>
          )}
          {value === recommended && (
            <span className={cls('iuk-quality__rec-badge')}>
              ⭐ {ui.qualityRecommended}
            </span>
          )}
        </div>
      </div>

      {note && (
        <div className={cls('iuk-quality__note')}>
          <Info size={12} aria-hidden="true" className={cls('iuk-quality__note-icon')} />
          <span>{isAr ? note.ar || note.en : note.en}</span>
        </div>
      )}
    </div>
  );
}

export default QualitySelector;
