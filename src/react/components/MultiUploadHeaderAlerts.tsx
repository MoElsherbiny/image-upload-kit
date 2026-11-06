import {
  AlertTriangleIcon as AlertTriangle,
  CheckCircleIcon as CheckCircle2,
  LoaderIcon as Loader2,
  SaveIcon as Save,
  TrashIcon as Trash2,
  XCircleIcon as XCircle,
} from '../icons';
import type { MultiUploadStats } from '../hooks/useMultiImageState';
import {
  formatNeedsAltMessage,
  formatUploadingCount,
  type UploadLocale,
  type UploadTranslations,
} from '../i18n';
import type {
  MultiUploadClassNames, MultiUploadSlot, MultiUploadStyles,
} from '../styling';
import { cx, resolveSlotClass, resolveSlotStyle } from '../utils/slotStyles';
import { SaveButton } from './SaveButton';

export interface MultiSlotStylingProps {
  unstyled?: boolean;
  providerClassNames?: MultiUploadClassNames;
  classNames?: MultiUploadClassNames;
  providerStyles?: MultiUploadStyles;
  styles?: MultiUploadStyles;
}

export interface MultiUploadHeaderAlertsProps extends MultiSlotStylingProps {
  label?: string;
  labelId?: string;
  inputId?: string;
  required?: boolean;
  disabled?: boolean;
  totalCount: number;
  selectedCount: number;
  uploadingCount: number;
  missingAltCount: number;
  isUploading: boolean;
  hasFailedUploads: boolean;
  infoMessage: string;
  showMissingAltWarning: boolean;
  uploadStats: MultiUploadStats;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  ui: UploadTranslations;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRemoveSelected: () => void;
  onRetryFailed: () => void;
}

export function MultiUploadHeaderAlerts({
  label, labelId, inputId, required = false, disabled = false,
  totalCount, selectedCount, uploadingCount, missingAltCount,
  isUploading, hasFailedUploads, infoMessage, showMissingAltWarning,
  uploadStats, locale = 'en', translations, ui,
  onSelectAll, onDeselectAll, onRemoveSelected, onRetryFailed,
  unstyled, providerClassNames, classNames, providerStyles, styles,
}: MultiUploadHeaderAlertsProps) {
  const slotClass = (slot: MultiUploadSlot, defaultClass?: string) =>
    resolveSlotClass(defaultClass, unstyled, providerClassNames?.[slot], classNames?.[slot]);
  const slotStyle = (slot: MultiUploadSlot) =>
    resolveSlotStyle(providerStyles?.[slot], styles?.[slot]);

  return (
    <>
      <div data-slot="header" className={slotClass('header', 'iuk-multi__header')} style={slotStyle('header')}>
        {(label || ui.uploadImages) && (
          <label
            id={labelId}
            htmlFor={inputId}
            data-slot="label"
            className={slotClass('label', 'iuk-label')}
            style={slotStyle('label')}
          >
            <span>{label || ui.uploadImages}</span>
            {required && <span className={resolveSlotClass('iuk-required', unstyled)}>*</span>}
            {totalCount > 0 && (
              <span data-slot="count" className={slotClass('count', 'iuk-multi__count')} style={slotStyle('count')}>
                ({totalCount})
              </span>
            )}
          </label>
        )}

        {totalCount > 0 && (
          <div data-slot="bulk-actions" className={slotClass('bulkActions', 'iuk-multi__bulk')} style={slotStyle('bulkActions')}>
            {selectedCount === 0 ? (
              <button
                type="button" onClick={onSelectAll} disabled={disabled}
                className={slotClass('bulkButton', 'iuk-btn iuk-btn--secondary iuk-btn--sm')}
                style={slotStyle('bulkButton')}
              >
                {ui.selectAll}
              </button>
            ) : (
              <>
                <button
                  type="button" onClick={onDeselectAll} disabled={disabled}
                  className={slotClass('bulkButton', 'iuk-btn iuk-btn--secondary iuk-btn--sm')}
                  style={slotStyle('bulkButton')}
                >
                  {ui.deselectAll} ({selectedCount})
                </button>
                <button
                  type="button" onClick={onRemoveSelected} disabled={disabled}
                  className={slotClass('bulkDangerButton', 'iuk-btn iuk-btn--danger iuk-btn--sm')}
                  style={slotStyle('bulkDangerButton')}
                >
                  <Trash2 size={14} />
                  <span>{ui.removeSelected}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {isUploading && (
        <div
          data-slot="alert"
          role="status"
          aria-live="polite"
          className={slotClass('alert', 'iuk-alert iuk-alert--info')}
          style={slotStyle('alert')}
        >
          <span className={resolveSlotClass('iuk-alert__row', unstyled)}>
            <Loader2 size={16} className={resolveSlotClass('iuk-spin', unstyled)} />
            <span>{formatUploadingCount(ui, uploadingCount, locale, translations)}...</span>
          </span>
          {uploadStats.total > 0 && (
            <strong>
              {uploadStats.completed + uploadStats.failed} / {uploadStats.total}
            </strong>
          )}
        </div>
      )}

      {hasFailedUploads && (
        <div
          data-slot="alert"
          role="alert"
          className={slotClass('alert', 'iuk-alert iuk-alert--error')}
          style={slotStyle('alert')}
        >
          <XCircle size={16} />
          <span>
            {ui.someUploadsFailed}{' '}
            <button
              type="button"
              onClick={onRetryFailed}
              disabled={isUploading || disabled}
              className={resolveSlotClass('iuk-link-btn', unstyled)}
            >
              {ui.retryFailedUploads}
            </button>
          </span>
        </div>
      )}

      {infoMessage && (
        <div
          data-slot="alert"
          role="status"
          className={slotClass('alert', 'iuk-alert iuk-alert--success')}
          style={slotStyle('alert')}
        >
          <CheckCircle2 size={16} />
          <span>{infoMessage}</span>
        </div>
      )}

      {showMissingAltWarning && missingAltCount > 0 && (
        <div
          data-slot="alert"
          role="alert"
          className={slotClass('alert', 'iuk-alert iuk-alert--warning')}
          style={slotStyle('alert')}
        >
          <AlertTriangle size={16} />
          <span>{formatNeedsAltMessage(ui, missingAltCount, locale)}</span>
        </div>
      )}
    </>
  );
}

export interface MultiFooterSectionProps extends MultiSlotStylingProps {
  helperText?: string;
  displayError?: string;
  statusTextId?: string;
  isOpen?: boolean;
  hasPreviews: boolean;
  hasCompletedPreviews: boolean;
  isUploading: boolean;
  disabled: boolean;
  requireAltText: boolean;
  missingAltCount: number;
  onSave: () => void;
  ui: UploadTranslations;
}

export function MultiFooterSection({
  helperText, displayError, statusTextId, isOpen, hasPreviews, hasCompletedPreviews,
  isUploading, disabled, requireAltText, missingAltCount, onSave, ui,
  unstyled, providerClassNames, classNames, providerStyles, styles,
}: MultiFooterSectionProps) {
  const slotClass = (slot: MultiUploadSlot, defaultClass?: string) =>
    resolveSlotClass(defaultClass, unstyled, providerClassNames?.[slot], classNames?.[slot]);
  const slotStyle = (slot: MultiUploadSlot) =>
    resolveSlotStyle(providerStyles?.[slot], styles?.[slot]);

  return (
    <>
      {(helperText || displayError) && (
        <p
          id={statusTextId}
          role={displayError ? 'alert' : undefined}
          data-slot={displayError ? 'error-text' : 'helper-text'}
          className={resolveSlotClass(
            cx('iuk-helper-text', Boolean(displayError) && 'iuk-helper-text--error'),
            unstyled,
            providerClassNames?.helperText, classNames?.helperText,
            Boolean(displayError) && providerClassNames?.errorText,
            Boolean(displayError) && classNames?.errorText,
          )}
          style={resolveSlotStyle(
            providerStyles?.helperText, styles?.helperText,
            displayError ? providerStyles?.errorText : undefined,
            displayError ? styles?.errorText : undefined,
          )}
        >
          {displayError || helperText}
        </p>
      )}

      {isOpen && hasPreviews && (
        <div data-slot="commit-bar" className={slotClass('commitBar', 'iuk-commit-bar')} style={slotStyle('commitBar')}>
          {requireAltText && missingAltCount > 0 && (
            <div className={resolveSlotClass('iuk-badge iuk-badge--warning', unstyled)}>
              <AlertTriangle size={13} />
              <span>{ui.withoutAltText.replace('{count}', String(missingAltCount))}</span>
            </div>
          )}
          <SaveButton
            unstyled={unstyled}
            className={slotClass('saveButton')}
            style={slotStyle('saveButton')}
            onClick={onSave}
            disabled={
              isUploading || disabled || !hasCompletedPreviews ||
              (requireAltText && missingAltCount > 0)
            }
            icon={<Save size={16} />}
          >
            {ui.saveImages}
          </SaveButton>
        </div>
      )}
    </>
  );
}
