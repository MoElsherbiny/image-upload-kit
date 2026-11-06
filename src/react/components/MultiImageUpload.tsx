import {
  type ChangeEvent, type ForwardedRef, Fragment, forwardRef, type HTMLAttributes,
  type ReactElement, type Ref, useId, useImperativeHandle, useRef,
} from 'react';
import { createPortal } from 'react-dom';
import type { UploadPresetName } from '../../types';
import { useImageUploadContext } from '../context';
import { useClipboardPaste } from '../hooks/useClipboardPaste';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useMultiImageState } from '../hooks/useMultiImageState';
import type { MultiUploadSlot } from '../styling';
import type { ImageUploadHandle, MultiImageUploadProps } from '../types';
import { HIDDEN_INPUT_STYLE, resolveSlotClass, resolveSlotStyle, resolveUploadDataState } from '../utils/slotStyles';
import { AltTextModal } from './AltTextModal';
import { MultiAddMoreTile, MultiEmptyDropzone } from './MultiDropzoneViews';
import { MultiFooterSection, MultiUploadHeaderAlerts } from './MultiUploadHeaderAlerts';
import { PreviewTile } from './PreviewTile';
import { QualitySelector } from './QualitySelector';
import { UploadProgressPanel, useRetainedProgressItems } from './UploadProgressPanel';

const DEFAULT_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml';
const FOLDER_INPUT_ATTRS: Record<string, string> = { webkitdirectory: '', directory: '' };

function MultiImageUploadInner<TPreset extends string = UploadPresetName>(
  props: MultiImageUploadProps<TPreset>,
  ref: ForwardedRef<ImageUploadHandle>,
) {
  const {
    preset, translations, renderImage, label, error, helperText, className, style,
    recommendedQuality, qualityNote, isOpen, maxImages = 999,
    accept = DEFAULT_ACCEPT, allowFolder = true, disabled = false,
    required = false, blurType = 'card', showQualitySelector = true,
    capture, enablePaste = true, pasteTarget = 'dropzone', name, onBlur,
    classNames: cCls, styles: cSty,
    renderHeader, renderEmptyDropzone, renderTile, renderAddMore,
  } = props;

  const ctx = useImageUploadContext();
  const isUnstyled = props.unstyled ?? ctx.unstyled;
  const pCls = ctx.multiClassNames;
  const pSty = ctx.multiStyles;

  const slotClass = (slot: MultiUploadSlot, defaultClass?: string) =>
    resolveSlotClass(defaultClass, isUnstyled, pCls?.[slot], cCls?.[slot]);
  const slotStyle = (slot: MultiUploadSlot) =>
    resolveSlotStyle(pSty?.[slot], cSty?.[slot]);

  const state = useMultiImageState(props);
  const { locale, ui, previews, selectedPreviews, uploadingPreviews, imagesWithoutAlt, editingTarget } = state;

  const rootRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const inputId = useId();
  const statusTextId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const dockItems = useRetainedProgressItems(uploadingPreviews, previews);

  const { isDragging, dragHandlers } = useDragAndDrop({
    disabled, onDrop: (files) => void state.handleFileSelect(files),
  });

  const { onPaste } = useClipboardPaste({
    enabled: enablePaste, pasteTarget, disabled, multiple: true,
    onPasteFiles: (files) => { void state.handleFileSelect(files); },
  });

  const openFilePicker = () => { if (!disabled) fileInputRef.current?.click(); };
  const openFolderPicker = () => { if (!disabled) folderInputRef.current?.click(); };
  const selectAll = () => state.setSelectedPreviews(new Set(previews.map((p) => p.id)));
  const clearSelection = () => state.setSelectedPreviews(new Set());
  const retryFailed = () => void state.handleRetryFailed();

  useImperativeHandle(ref, () => ({
    focus: () => {
      const focusable = rootRef.current?.querySelector<HTMLElement>(
        '[data-slot="empty-dropzone"], [data-slot="empty-actions"] button, [data-slot="add-more"] button',
      );
      (focusable ?? rootRef.current)?.focus();
    },
    open: openFilePicker,
    clear: () => state.handleClearAll(),
  }));

  const handleFilesInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) void state.handleFileSelect(e.target.files);
    e.target.value = '';
  };

  const displayError = error || state.validationError;
  const hasError = Boolean(displayError) || state.hasFailedUploads;
  const hasStatusText = Boolean(helperText || displayError);
  const visualState = resolveUploadDataState({
    disabled, hasError, isUploading: state.isUploading, isDragging, hasContent: previews.length > 0,
  });

  const dropzoneProps: HTMLAttributes<HTMLElement> & { 'data-state'?: string } = {
    ...dragHandlers, onPaste,
    role: 'button', tabIndex: disabled ? -1 : 0,
    'aria-label': ui.selectFilesAria, 'aria-disabled': disabled || undefined,
    'aria-required': required || undefined, 'aria-invalid': hasError || undefined,
    'aria-describedby': hasStatusText ? statusTextId : undefined,
    'data-state': visualState,
    onClick: () => { if (!disabled) openFilePicker(); },
    onKeyDown: (event) => {
      if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        openFilePicker();
      }
    },
  };

  const slotStylingProps = {
    unstyled: isUnstyled, providerClassNames: pCls, classNames: cCls, providerStyles: pSty, styles: cSty,
  };
  const hiddenInputClass = resolveSlotClass('iuk-hidden-input', isUnstyled);
  const hiddenInputStyle = isUnstyled ? HIDDEN_INPUT_STYLE : undefined;

  return (
    <>
      <div
        ref={rootRef} data-slot="multi-root" data-state={visualState} data-unstyled={isUnstyled || undefined}
        className={resolveSlotClass('iuk-multi', isUnstyled, pCls?.root, cCls?.root, className)}
        style={resolveSlotStyle(pSty?.root, cSty?.root, style)} dir={locale === 'ar' ? 'rtl' : 'ltr'}
        onPaste={onPaste}
        onBlur={onBlur ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur(); } : undefined}
      >
        {name && (
          <input type="hidden" name={name} value={state.serializedFormValue} required={required} data-slot="form-input" />
        )}

        {renderHeader ? (
          renderHeader({
            label, required, disabled, totalCount: previews.length,
            selectedCount: selectedPreviews.size, uploadingCount: uploadingPreviews.length,
            isUploading: state.isUploading, hasFailedUploads: state.hasFailedUploads,
            selectAll, clearSelection, removeSelected: state.handleRemoveSelected,
            retryFailed, locale, ui,
          })
        ) : (
          <MultiUploadHeaderAlerts
            label={label} labelId={labelId} inputId={inputId} required={required} disabled={disabled}
            totalCount={previews.length} selectedCount={selectedPreviews.size}
            uploadingCount={uploadingPreviews.length} missingAltCount={imagesWithoutAlt.length}
            isUploading={state.isUploading} hasFailedUploads={state.hasFailedUploads}
            infoMessage={state.infoMessage} showMissingAltWarning={state.showMissingAltWarning}
            uploadStats={state.uploadStats} locale={locale} translations={translations} ui={ui}
            onSelectAll={selectAll} onDeselectAll={clearSelection}
            onRemoveSelected={state.handleRemoveSelected} onRetryFailed={retryFailed} {...slotStylingProps}
          />
        )}

        {showQualitySelector && (
          <div data-slot="quality-selector" className={slotClass('qualitySelector')} style={slotStyle('qualitySelector')}>
            <QualitySelector
              value={state.qualityLevel} onChange={state.setQualityLevel}
              preset={preset} recommendedLevel={recommendedQuality}
              recommendationNote={qualityNote} locale={locale}
              disabled={state.isUploading || disabled} unstyled={isUnstyled}
            />
          </div>
        )}

        <input
          id={inputId} ref={fileInputRef} type="file" accept={accept} capture={capture}
          onChange={handleFilesInputChange} className={hiddenInputClass} style={hiddenInputStyle}
          disabled={disabled} multiple aria-label={ui.selectFilesAria}
          aria-invalid={hasError || undefined}
          aria-describedby={hasStatusText ? statusTextId : undefined}
        />
        <input
          ref={folderInputRef} type="file" accept={accept} onChange={handleFilesInputChange}
          className={hiddenInputClass} style={hiddenInputStyle}
          disabled={disabled} {...FOLDER_INPUT_ATTRS} aria-label={ui.selectFolderAria}
        />

        {previews.length === 0 ? (
          renderEmptyDropzone ? (
            renderEmptyDropzone({
              state: visualState, isDragging, disabled, allowFolder,
              maxSizeMB: state.maxSizeMB, maxImages, error: displayError || undefined,
              openFileDialog: openFilePicker, openFolderDialog: openFolderPicker,
              dropzoneProps, locale, ui,
            })
          ) : (
            <MultiEmptyDropzone
              isDragging={isDragging} disabled={disabled} hasError={Boolean(displayError)}
              required={required} enablePaste={enablePaste}
              visualState={visualState} allowFolder={allowFolder} maxSizeMB={state.maxSizeMB}
              ui={ui} dragHandlers={dragHandlers} onPaste={onPaste}
              onSelectFiles={openFilePicker} onSelectFolder={openFolderPicker} {...slotStylingProps}
            />
          )
        ) : (
          <div data-slot="grid" className={slotClass('grid', 'iuk-multi__grid')} style={slotStyle('grid')}>
            {previews.map((item, index) =>
              renderTile ? (
                <Fragment key={item.id}>
                  {renderTile({
                    item, index, isSelected: selectedPreviews.has(item.id), disabled,
                    toggleSelect: () => state.toggleSelect(item.id),
                    remove: () => state.handleRemove(item.id),
                    cancel: () => state.handleCancelUpload(item.id),
                    retry: () => void state.handleRetryUpload(item.id),
                    openAltTextModal: () => state.setEditingAltTextId(item.id),
                    setAltText: (altText) => state.handleAltTextSave(item.id, altText),
                    setBlurColor: (hex) => state.handleColorChange(item.id, hex),
                    locale, ui,
                  })}
                </Fragment>
              ) : (
                <PreviewTile
                  key={item.id} preview={item} onRemove={state.handleRemove}
                  onCancel={state.handleCancelUpload}
                  onRetry={(id) => void state.handleRetryUpload(id)}
                  disabled={disabled} blurType={blurType} isSelected={selectedPreviews.has(item.id)}
                  onToggleSelect={state.toggleSelect} onEditAltText={(id) => state.setEditingAltTextId(id)}
                  onChangeAltText={state.handleAltTextSave} onChangeColor={state.handleColorChange}
                  locale={locale} translations={translations} renderImage={renderImage}
                  unstyled={isUnstyled} className={slotClass('tile')} style={slotStyle('tile')}
                />
              ),
            )}

            {renderAddMore ? (
              renderAddMore({
                isDragging, disabled, allowFolder,
                remainingCount: Math.max(0, maxImages - previews.length),
                openFileDialog: openFilePicker, openFolderDialog: openFolderPicker,
                dropzoneProps, locale, ui,
              })
            ) : (
              <MultiAddMoreTile
                isDragging={isDragging} disabled={disabled} allowFolder={allowFolder} ui={ui}
                dragHandlers={dragHandlers} onSelectFiles={openFilePicker} onSelectFolder={openFolderPicker}
                {...slotStylingProps}
              />
            )}
          </div>
        )}

        <MultiFooterSection
          helperText={helperText} displayError={displayError} statusTextId={statusTextId} isOpen={isOpen}
          hasPreviews={previews.length > 0} hasCompletedPreviews={state.completedPreviews.length > 0}
          isUploading={state.isUploading} disabled={disabled} requireAltText={state.requireAltText}
          missingAltCount={imagesWithoutAlt.length} onSave={state.handleSaveImages} ui={ui} {...slotStylingProps}
        />
      </div>

      {editingTarget && (
        <AltTextModal
          imageUrl={editingTarget.url} initialAltText={editingTarget.altText}
          onSave={(nextAlt) => state.handleAltTextSave(editingTarget.id, nextAlt)}
          onClose={() => state.setEditingAltTextId(null)}
          locale={locale} translations={translations} renderImage={renderImage} unstyled={isUnstyled}
        />
      )}

      {typeof document !== 'undefined' && dockItems.length > 0 &&
        createPortal(
          <UploadProgressPanel
            items={dockItems} completedCount={state.uploadStats.completed}
            totalCount={state.uploadStats.total} locale={locale}
            translations={translations} renderImage={renderImage} unstyled={isUnstyled}
          />,
          document.body,
        )}
    </>
  );
}

export const MultiImageUpload = forwardRef(MultiImageUploadInner) as <
  TPreset extends string = UploadPresetName,
>(
  props: MultiImageUploadProps<TPreset> & { ref?: Ref<ImageUploadHandle> },
) => ReactElement | null;

export default MultiImageUpload;
