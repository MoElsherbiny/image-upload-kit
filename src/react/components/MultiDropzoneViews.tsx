import { FolderOpen, ImagePlus, Upload } from 'lucide-react';
import type { DragEvent } from 'react';
import type { UploadTranslations } from '../i18n';
import type {
  MultiUploadClassNames,
  MultiUploadSlot,
  MultiUploadStyles,
  UploadVisualState,
} from '../styling';
import {
  cx,
  resolveSlotClass,
  resolveSlotStyle,
  resolveUploadDataState,
} from '../utils/slotStyles';

export interface DropzoneDragHandlers {
  onDragEnter: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

export interface MultiDropzoneSlotProps {
  unstyled?: boolean;
  providerClassNames?: MultiUploadClassNames;
  classNames?: MultiUploadClassNames;
  providerStyles?: MultiUploadStyles;
  styles?: MultiUploadStyles;
}

export interface MultiEmptyDropzoneProps extends MultiDropzoneSlotProps {
  isDragging: boolean;
  disabled?: boolean;
  hasError?: boolean;
  visualState?: UploadVisualState;
  allowFolder?: boolean;
  maxSizeMB: number;
  ui: UploadTranslations;
  dragHandlers: DropzoneDragHandlers;
  onSelectFiles: () => void;
  onSelectFolder: () => void;
}

export function MultiEmptyDropzone({
  isDragging,
  disabled = false,
  hasError = false,
  visualState: propVisualState,
  allowFolder = true,
  maxSizeMB,
  ui,
  dragHandlers,
  onSelectFiles,
  onSelectFolder,
  unstyled,
  providerClassNames: pCls,
  classNames: cCls,
  providerStyles: pSty,
  styles: cSty,
}: MultiEmptyDropzoneProps) {
  const visualState =
    propVisualState ?? resolveUploadDataState({ disabled, hasError, isDragging });

  const slotClass = (slot: MultiUploadSlot, defaultClass?: string) =>
    resolveSlotClass(defaultClass, unstyled, pCls?.[slot], cCls?.[slot]);
  const slotStyle = (slot: MultiUploadSlot) =>
    resolveSlotStyle(pSty?.[slot], cSty?.[slot]);

  const rootClassName = resolveSlotClass(
    cx(
      'iuk-multi__empty',
      isDragging && 'iuk-multi__empty--dragging',
      disabled && 'iuk-multi__empty--disabled',
      hasError && 'iuk-multi__empty--error',
    ),
    unstyled,
    pCls?.emptyDropzone, cCls?.emptyDropzone,
    isDragging && pCls?.emptyDropzoneDragging, isDragging && cCls?.emptyDropzoneDragging,
    disabled && pCls?.emptyDropzoneDisabled, disabled && cCls?.emptyDropzoneDisabled,
    hasError && pCls?.emptyDropzoneError, hasError && cCls?.emptyDropzoneError,
  );

  const rootStyle = resolveSlotStyle(
    pSty?.emptyDropzone, cSty?.emptyDropzone,
    isDragging ? pSty?.emptyDropzoneDragging : undefined,
    isDragging ? cSty?.emptyDropzoneDragging : undefined,
    disabled ? pSty?.emptyDropzoneDisabled : undefined,
    disabled ? cSty?.emptyDropzoneDisabled : undefined,
    hasError ? pSty?.emptyDropzoneError : undefined,
    hasError ? cSty?.emptyDropzoneError : undefined,
  );

  return (
    <div
      data-slot="empty-dropzone"
      data-state={visualState}
      data-dragging={isDragging || undefined}
      data-disabled={disabled || undefined}
      data-error={hasError || undefined}
      className={rootClassName}
      style={rootStyle}
      {...dragHandlers}
    >
      <div className={resolveSlotClass('iuk-dropzone__prompt', unstyled)}>
        <div className={resolveSlotClass('iuk-dropzone__icon', unstyled)}>
          <ImagePlus size={40} strokeWidth={1.5} />
        </div>
        <h3
          data-slot="empty-title"
          className={slotClass('emptyTitle', 'iuk-multi__title')}
          style={slotStyle('emptyTitle')}
        >
          {isDragging ? ui.dropImagesHere : ui.uploadImages}
        </h3>
        <p
          data-slot="empty-hint"
          className={slotClass('emptyHint', 'iuk-dropzone__hint')}
          style={slotStyle('emptyHint')}
        >
          {isDragging ? ui.releaseToUpload : ui.dragDropOrChoose}
        </p>

        {!isDragging && (
          <div
            data-slot="empty-actions"
            className={slotClass('emptyActions', 'iuk-multi__btn-row')}
            style={slotStyle('emptyActions')}
          >
            <button
              type="button"
              onClick={onSelectFiles}
              className={slotClass('primaryButton', 'iuk-btn iuk-btn--primary')}
              style={slotStyle('primaryButton')}
              disabled={disabled}
            >
              <Upload size={16} />
              <span>{ui.selectFiles}</span>
            </button>
            {allowFolder && (
              <button
                type="button"
                onClick={onSelectFolder}
                className={slotClass('secondaryButton', 'iuk-btn iuk-btn--secondary')}
                style={slotStyle('secondaryButton')}
                disabled={disabled}
              >
                <FolderOpen size={16} />
                <span>{ui.selectFolder}</span>
              </button>
            )}
          </div>
        )}

        {!isDragging && (
          <p
            data-slot="empty-subtext"
            className={slotClass('emptySubtext', 'iuk-multi__subtext')}
            style={slotStyle('emptySubtext')}
          >
            {ui.supportsFormats} •{' '}
            {ui.maxPerFile.replace('{size}', String(maxSizeMB))}
          </p>
        )}
      </div>
    </div>
  );
}

export interface MultiAddMoreTileProps extends MultiDropzoneSlotProps {
  isDragging: boolean;
  disabled?: boolean;
  allowFolder?: boolean;
  ui: UploadTranslations;
  dragHandlers: DropzoneDragHandlers;
  onSelectFiles: () => void;
  onSelectFolder: () => void;
}

export function MultiAddMoreTile({
  isDragging,
  disabled = false,
  allowFolder = true,
  ui,
  dragHandlers,
  onSelectFiles,
  onSelectFolder,
  unstyled,
  providerClassNames: pCls,
  classNames: cCls,
  providerStyles: pSty,
  styles: cSty,
}: MultiAddMoreTileProps) {
  const slotClass = (slot: MultiUploadSlot, defaultClass?: string) =>
    resolveSlotClass(defaultClass, unstyled, pCls?.[slot], cCls?.[slot]);
  const slotStyle = (slot: MultiUploadSlot) =>
    resolveSlotStyle(pSty?.[slot], cSty?.[slot]);

  const rootClassName = resolveSlotClass(
    cx(
      'iuk-tile iuk-tile--add-more',
      isDragging && 'iuk-tile--dragging',
      disabled && 'iuk-tile--disabled',
    ),
    unstyled,
    pCls?.addMoreTile, cCls?.addMoreTile,
    isDragging && pCls?.addMoreTileDragging, isDragging && cCls?.addMoreTileDragging,
  );

  const rootStyle = resolveSlotStyle(
    pSty?.addMoreTile, cSty?.addMoreTile,
    isDragging ? pSty?.addMoreTileDragging : undefined,
    isDragging ? cSty?.addMoreTileDragging : undefined,
  );

  return (
    <div
      data-slot="add-more"
      data-dragging={isDragging || undefined}
      data-disabled={disabled || undefined}
      className={rootClassName}
      style={rootStyle}
      {...dragHandlers}
    >
      <div
        data-slot="add-more-content"
        className={slotClass('addMoreContent', 'iuk-tile__add-content')}
        style={slotStyle('addMoreContent')}
      >
        <ImagePlus size={28} strokeWidth={1.5} />
        <p>{isDragging ? ui.dropHere : ui.addMore}</p>
        {!isDragging && (
          <div
            data-slot="add-more-actions"
            className={slotClass('addMoreActions', 'iuk-tile__add-btns')}
            style={slotStyle('addMoreActions')}
          >
            <button
              type="button"
              onClick={onSelectFiles}
              className={slotClass('secondaryButton', 'iuk-btn iuk-btn--secondary iuk-btn--sm')}
              style={slotStyle('secondaryButton')}
              disabled={disabled}
            >
              <Upload size={13} />
              <span>{ui.files}</span>
            </button>
            {allowFolder && (
              <button
                type="button"
                onClick={onSelectFolder}
                className={slotClass('secondaryButton', 'iuk-btn iuk-btn--secondary iuk-btn--sm')}
                style={slotStyle('secondaryButton')}
                disabled={disabled}
              >
                <FolderOpen size={13} />
                <span>{ui.folder}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
