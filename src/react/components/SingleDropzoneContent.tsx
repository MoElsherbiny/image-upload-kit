import {
  AlertTriangleIcon as AlertTriangle,
  DownloadIcon as Download,
  ImagePlusIcon as ImagePlus,
  SaveIcon as Save,
  UploadIcon as Upload,
} from '../icons';
import type { CSSProperties } from 'react';
import type { UploadTranslations } from '../i18n';
import type {
  SingleUploadClassNames,
  SingleUploadSlot,
  SingleUploadStyles,
} from '../styling';
import { cx, resolveSlotClass, resolveSlotStyle } from '../utils/slotStyles';
import { SaveButton } from './SaveButton';

function formatCompactBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface SingleSlotStylingProps {
  unstyled?: boolean;
  providerClassNames?: SingleUploadClassNames;
  classNames?: SingleUploadClassNames;
  providerStyles?: SingleUploadStyles;
  styles?: SingleUploadStyles;
}

export function resolveSingleDropzoneSlot(
  flags: {
    isDragging: boolean;
    hasPreview: boolean;
    disabled: boolean;
    hasError: boolean;
  },
  styling: SingleSlotStylingProps,
): { className?: string; style?: CSSProperties } {
  const { isDragging, hasPreview, disabled, hasError } = flags;
  const { unstyled, providerClassNames: pCls, classNames: cCls, providerStyles: pSty, styles: cSty } = styling;
  return {
    className: resolveSlotClass(
      cx(
        'iuk-dropzone',
        isDragging && 'iuk-dropzone--dragging',
        hasPreview && 'iuk-dropzone--has-image',
        disabled && 'iuk-dropzone--disabled',
        hasError && 'iuk-dropzone--error',
      ),
      unstyled,
      pCls?.dropzone, cCls?.dropzone,
      isDragging && pCls?.dropzoneDragging, isDragging && cCls?.dropzoneDragging,
      hasPreview && pCls?.dropzoneHasImage, hasPreview && cCls?.dropzoneHasImage,
      disabled && pCls?.dropzoneDisabled, disabled && cCls?.dropzoneDisabled,
      hasError && pCls?.dropzoneError, hasError && cCls?.dropzoneError,
    ),
    style: resolveSlotStyle(
      pSty?.dropzone, cSty?.dropzone,
      isDragging ? pSty?.dropzoneDragging : undefined, isDragging ? cSty?.dropzoneDragging : undefined,
      hasPreview ? pSty?.dropzoneHasImage : undefined, hasPreview ? cSty?.dropzoneHasImage : undefined,
      disabled ? pSty?.dropzoneDisabled : undefined, disabled ? cSty?.dropzoneDisabled : undefined,
      hasError ? pSty?.dropzoneError : undefined, hasError ? cSty?.dropzoneError : undefined,
    ),
  };
}

export interface SingleDropzoneEmptyPromptProps extends SingleSlotStylingProps {
  isUploading: boolean;
  uploadMessage: string;
  showProgress: boolean;
  progress: number;
  maxSizeMB: number;
  ui: UploadTranslations;
}

export function SingleDropzoneEmptyPrompt({
  isUploading, uploadMessage, showProgress, progress, maxSizeMB, ui,
  unstyled, providerClassNames, classNames, providerStyles, styles,
}: SingleDropzoneEmptyPromptProps) {
  const slotClass = (slot: SingleUploadSlot, defaultClass?: string) =>
    resolveSlotClass(defaultClass, unstyled, providerClassNames?.[slot], classNames?.[slot]);
  const slotStyle = (slot: SingleUploadSlot) =>
    resolveSlotStyle(providerStyles?.[slot], styles?.[slot]);

  return (
    <div
      data-slot="dropzone-prompt"
      className={slotClass('dropzonePrompt', 'iuk-dropzone__prompt')}
      style={slotStyle('dropzonePrompt')}
    >
      <div
        data-slot="dropzone-icon"
        className={slotClass('dropzoneIcon', 'iuk-dropzone__icon')}
        style={slotStyle('dropzoneIcon')}
      >
        {isUploading ? (
          <div className={resolveSlotClass('iuk-spinner', unstyled)} />
        ) : (
          <ImagePlus size={36} strokeWidth={1.5} />
        )}
      </div>
      <p
        data-slot="dropzone-text"
        className={slotClass('dropzoneText', 'iuk-dropzone__text')}
        style={slotStyle('dropzoneText')}
      >
        {isUploading ? uploadMessage || `${ui.uploading}...` : ui.dragDropOrClickToUpload}
      </p>
      {isUploading && showProgress && progress > 0 && (
        <p
          data-slot="dropzone-progress"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={ui.uploading}
          className={slotClass('dropzoneProgress', 'iuk-dropzone__progress')}
          style={slotStyle('dropzoneProgress')}
        >
          {progress}%
        </p>
      )}
      {!isUploading && (
        <>
          <p
            data-slot="dropzone-hint"
            className={slotClass('dropzoneHint', 'iuk-dropzone__hint')}
            style={slotStyle('dropzoneHint')}
          >
            {ui.upToSizeMB.replace('{size}', String(maxSizeMB))}
          </p>
          <span
            data-slot="browse-button"
            className={slotClass('browseButton', 'iuk-btn iuk-btn--secondary')}
            style={slotStyle('browseButton')}
          >
            <Upload size={15} />
            <span>{ui.browseFiles}</span>
          </span>
        </>
      )}
    </div>
  );
}

export interface SingleStatusFooterProps extends SingleSlotStylingProps {
  showMissingAltWarning: boolean;
  hasPreview: boolean;
  hasAltText: boolean;
  uploadMessage: string;
  isUploading: boolean;
  sizeInfo: { original: number; optimized: number } | null;
  canDownload: boolean;
  onDownload: () => void;
  helperText?: string;
  displayError?: string;
  statusTextId?: string;
  isOpen?: boolean;
  requireAltText?: boolean;
  disabled?: boolean;
  onSave?: () => void;
  ui: UploadTranslations;
}

export function SingleStatusFooter({
  showMissingAltWarning, hasPreview, hasAltText, uploadMessage, isUploading,
  sizeInfo, canDownload, onDownload, helperText, displayError, statusTextId,
  isOpen, requireAltText, disabled, onSave, ui,
  unstyled, providerClassNames, classNames, providerStyles, styles,
}: SingleStatusFooterProps) {
  const slotClass = (slot: SingleUploadSlot, defaultClass?: string) =>
    resolveSlotClass(defaultClass, unstyled, providerClassNames?.[slot], classNames?.[slot]);
  const slotStyle = (slot: SingleUploadSlot) =>
    resolveSlotStyle(providerStyles?.[slot], styles?.[slot]);

  return (
    <>
      {showMissingAltWarning && hasPreview && !hasAltText && (
        <div
          data-slot="alert"
          role="alert"
          className={slotClass('alert', 'iuk-alert iuk-alert--warning')}
          style={slotStyle('alert')}
        >
          <AlertTriangle size={16} />
          <span>{ui.addAltBeforeSaving}</span>
        </div>
      )}

      {uploadMessage && !isUploading && sizeInfo && (
        <div
          data-slot="alert"
          role="status"
          className={slotClass('alert', 'iuk-alert iuk-alert--success')}
          style={slotStyle('alert')}
        >
          <span>{uploadMessage}</span>
        </div>
      )}

      {hasPreview && canDownload && (
        <button
          type="button"
          data-slot="download-button"
          className={slotClass('downloadButton', 'iuk-btn iuk-btn--secondary iuk-single__download')}
          style={slotStyle('downloadButton')}
          onClick={onDownload}
          disabled={isUploading}
          aria-label={ui.downloadImage}
        >
          <Download size={15} aria-hidden="true" />
          <span>{ui.downloadImage}</span>
          {sizeInfo && (
            <span className={resolveSlotClass('iuk-badge', unstyled)}>
              {formatCompactBytes(sizeInfo.optimized)}
            </span>
          )}
        </button>
      )}

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

      {isOpen && hasPreview && onSave && (
        <div
          data-slot="commit-bar"
          className={slotClass('commitBar', 'iuk-commit-bar')}
          style={slotStyle('commitBar')}
        >
          {requireAltText && !hasAltText && (
            <div className={resolveSlotClass('iuk-badge iuk-badge--warning', unstyled)}>
              <AlertTriangle size={13} />
              <span>{ui.missingDescription}</span>
            </div>
          )}
          <SaveButton
            unstyled={unstyled}
            className={slotClass('saveButton')}
            style={slotStyle('saveButton')}
            onClick={onSave}
            disabled={isUploading || disabled || Boolean(requireAltText && !hasAltText)}
            icon={<Save size={16} />}
          >
            {ui.saveImage}
          </SaveButton>
        </div>
      )}
    </>
  );
}
