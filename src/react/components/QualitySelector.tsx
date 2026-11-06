import { CheckIcon as Check, InfoIcon as Info, ZapIcon as Zap } from '../icons';
import type {
  QualityLevel,
  StandardPresetName,
  UploadLocale,
} from '../../types';
import { QUALITY_PRESETS, STANDARD_PRESETS } from '../../types';
import { estimateOutputSize } from '../../utils/formatters';

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
  disabled?: boolean;
}

export function QualitySelector({
  value,
  onChange,
  preset,
  recommendedLevel,
  recommendationNote,
  originalFileSize,
  locale = 'en',
  disabled = false,
}: QualitySelectorProps) {
  const isAr = locale === 'ar';
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

  return (
    <div
      className="iuk-quality"
      dir={isAr ? 'rtl' : 'ltr'}
      aria-label={isAr ? 'جودة الضغط' : 'Compression quality'}
    >
      <div className="iuk-quality__header">
        <span className="iuk-quality__title">
          {isAr ? 'جودة الضغط' : 'Compression Quality'}
        </span>
        <span className={`iuk-quality__pill iuk-quality__pill--${value}`}>
          {isAr ? selected.labelAr : selected.label} · Q{selected.value}
        </span>
      </div>

      <div
        className="iuk-quality__tabs"
        role="radiogroup"
        aria-label={isAr ? 'مستوى الجودة' : 'Quality level'}
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
              disabled={disabled}
              onClick={() => !disabled && onChange(level)}
              className={[
                'iuk-quality__tab',
                isSelected ? 'iuk-quality__tab--selected' : '',
                isRecommended && !isSelected
                  ? 'iuk-quality__tab--recommended'
                  : '',
                disabled ? 'iuk-quality__tab--disabled' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {isSelected && (
                <Check size={11} strokeWidth={3} aria-hidden="true" />
              )}
              <span>{isAr ? item.labelAr : item.label}</span>
              {isRecommended && !isSelected && (
                <span className="iuk-quality__star" aria-hidden="true">
                  ★
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className={`iuk-quality__detail iuk-quality__detail--${value}`}>
        <p className="iuk-quality__desc">
          {isAr ? selected.descriptionAr : selected.description}
        </p>
        <div className="iuk-quality__meta">
          <span className="iuk-quality__tag">Q{selected.value}</span>
          {estimatedSize !== null && (
            <>
              <span className="iuk-quality__dot" aria-hidden="true" />
              <Zap size={11} aria-hidden="true" />
              <span>~{formatBytesCompact(estimatedSize)}</span>
              <span className="iuk-quality__dot" aria-hidden="true" />
              <span className="iuk-quality__saving">
                {saving}% {isAr ? 'توفير' : 'saved'}
              </span>
            </>
          )}
          {value === recommended && (
            <span className="iuk-quality__rec-badge">
              {isAr ? '⭐ موصى به' : '⭐ Recommended'}
            </span>
          )}
        </div>
      </div>

      {note && (
        <div className="iuk-quality__note">
          <Info size={12} aria-hidden="true" className="iuk-quality__note-icon" />
          <span>{isAr ? note.ar || note.en : note.en}</span>
        </div>
      )}
    </div>
  );
}

export default QualitySelector;
