import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon as CheckCircle2,
  LoaderIcon as Loader2,
  PaletteIcon as Palette,
  StarIcon,
  TypeIcon,
  XIcon as X,
  XCircleIcon as XCircle,
} from '../icons';
import type { UploadTranslations } from '../i18n';
import type { ImagePreview } from '../types';
import { cx, resolveSlotClass } from '../utils/slotStyles';

export interface PreviewTileActionsProps {
  preview: ImagePreview;
  ui: UploadTranslations;
  isUnstyled?: boolean;
  disabled: boolean;
  isUploading: boolean;
  hasError: boolean;
  isSuccess: boolean;
  reductionPercent: number;
  actualBlurColor?: string;
  showCheckbox: boolean;
  isSelected: boolean;
  index?: number;
  totalCount?: number;
  reorderable?: boolean;
  showCoverBadge?: boolean;
  onToggleSelect?: (id: string) => void;
  onEditAltText?: (id: string) => void;
  onOpenBlurInspector: () => void;
  onRemove: (id: string) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  onMove?: (fromIndex: number, toIndex: number) => void;
  onSetCover?: (index: number) => void;
}

export function PreviewTileActions({
  preview, ui, isUnstyled, disabled, isUploading, hasError, isSuccess,
  reductionPercent, actualBlurColor, showCheckbox, isSelected,
  index = 0, totalCount = 1, reorderable = false, showCoverBadge = false,
  onToggleSelect, onEditAltText, onOpenBlurInspector,
  onRemove, onCancel, onRetry, onMove, onSetCover,
}: PreviewTileActionsProps) {
  const cls = (defaultClass: string) => resolveSlotClass(defaultClass, isUnstyled);

  return (
    <>
      {showCoverBadge && index === 0 && !hasError && (
        <span data-slot="cover-badge" className={cls('iuk-cover-badge')}>
          <StarIcon size={11} />
          <span>{ui.coverBadge}</span>
        </span>
      )}

      {showCheckbox && !disabled && !isUploading && onToggleSelect && (
        <div data-slot="tile-checkbox" className={cls('iuk-tile__checkbox')} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox" checked={isSelected}
            onChange={() => onToggleSelect(preview.id)} aria-label={ui.selectImageAria}
          />
        </div>
      )}

      {!disabled && onEditAltText && (
        <button
          type="button" data-slot="tile-alt-btn"
          className={cls(cx('iuk-tile__action iuk-tile__action--alt', Boolean(preview.altText) && 'iuk-tile__action--has-alt'))}
          onClick={(e) => { e.stopPropagation(); onEditAltText(preview.id); }}
          aria-label={preview.altText ? ui.editAltTextAria : ui.addAltTextAria}
          title={preview.altText ? ui.editPrefix.replace('{title}', preview.altText) : ui.addDescriptionForA11y}
        >
          {preview.altText ? <CheckCircle2 size={14} /> : <TypeIcon size={14} />}
        </button>
      )}

      {!disabled && !isUploading && (
        <button
          type="button" data-slot="tile-blur-btn" className={cls('iuk-tile__action iuk-tile__action--blur')}
          onClick={(e) => { e.stopPropagation(); onOpenBlurInspector(); }}
          aria-label={ui.adjustBlurColorAria} title={ui.adjustBlurColorTitle}
        >
          <Palette size={14} />
        </button>
      )}

      {!disabled && !isUploading && (
        <button
          type="button" data-slot="tile-remove-btn" className={cls('iuk-tile__action iuk-tile__action--remove')}
          onClick={(e) => { e.stopPropagation(); onRemove(preview.id); }}
          aria-label={ui.removeImageAria}
        >
          <X size={15} />
        </button>
      )}

      {reorderable && totalCount > 1 && !disabled && !isUploading && !hasError && (
        <div data-slot="tile-reorder-bar" className={cls('iuk-tile-reorder-bar')} onClick={(e) => e.stopPropagation()}>
          <button
            type="button" data-slot="tile-move-earlier" className={cls('iuk-tile__reorder-btn')}
            disabled={index === 0} aria-label={ui.moveEarlier} title={ui.moveEarlier}
            onClick={(e) => { e.stopPropagation(); if (index > 0) onMove?.(index, index - 1); }}
          >
            <ArrowLeftIcon size={13} />
          </button>

          {index > 0 && (
            <button
              type="button" data-slot="tile-set-cover"
              className={cls('iuk-tile__reorder-btn iuk-tile__reorder-btn--cover')}
              aria-label={ui.setAsCover} title={ui.setAsCover}
              onClick={(e) => { e.stopPropagation(); onSetCover?.(index); }}
            >
              <StarIcon size={12} />
            </button>
          )}

          <button
            type="button" data-slot="tile-move-later" className={cls('iuk-tile__reorder-btn')}
            disabled={index >= totalCount - 1} aria-label={ui.moveLater} title={ui.moveLater}
            onClick={(e) => { e.stopPropagation(); if (index < totalCount - 1) onMove?.(index, index + 1); }}
          >
            <ArrowRightIcon size={13} />
          </button>
        </div>
      )}

      {isUploading && (
        <div data-slot="tile-overlay" className={cls('iuk-tile__overlay')}>
          <Loader2 size={24} className={cls('iuk-spin')} />
          <p className={cls('iuk-tile__status')}>{preview.uploadMessage || `${ui.uploading}...`}</p>
          {preview.progress !== undefined && preview.progress > 0 && (
            <div
              role="progressbar" aria-valuenow={Math.round(preview.progress)}
              aria-valuemin={0} aria-valuemax={100} aria-label={ui.uploading}
              className={cls('iuk-progress-bar')}
            >
              <div className={cls('iuk-progress-bar__fill')} style={{ width: `${preview.progress}%` }} />
            </div>
          )}
          {!disabled && (
            <button
              type="button" data-slot="tile-cancel"
              className={cls('iuk-btn iuk-btn--secondary iuk-btn--sm iuk-tile__cancel-btn')}
              onClick={(e) => { e.stopPropagation(); (onCancel ?? onRemove)(preview.id); }}
              aria-label={ui.cancelUpload}
            >
              <X size={13} />
              <span>{ui.cancelUpload}</span>
            </button>
          )}
        </div>
      )}

      {isSuccess && (
        <div data-slot="tile-badge" className={cls('iuk-tile__badge iuk-tile__badge--success')}>
          <CheckCircle2 size={13} />
          {reductionPercent > 0 && <span>-{reductionPercent}%</span>}
        </div>
      )}

      {!disabled && !isUploading && !hasError && actualBlurColor && (
        <div data-slot="tile-color-badge" className={cls('iuk-tile__badge iuk-tile__badge--color')}>
          <span className={cls('iuk-tile__color-dot')} style={{ backgroundColor: actualBlurColor }} />
          <code>{actualBlurColor.toUpperCase()}</code>
        </div>
      )}

      {hasError && (
        <div data-slot="tile-error" role="alert" className={cls('iuk-tile__overlay iuk-tile__overlay--error')}>
          <XCircle size={22} />
          <p>{preview.error}</p>
          {!disabled && onRetry && (
            <button
              type="button" data-slot="tile-retry"
              className={cls('iuk-btn iuk-btn--secondary iuk-btn--sm iuk-tile__retry-btn')}
              onClick={(e) => { e.stopPropagation(); onRetry(preview.id); }}
              aria-label={ui.retryUpload}
            >
              <span>{ui.retryUpload}</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}
