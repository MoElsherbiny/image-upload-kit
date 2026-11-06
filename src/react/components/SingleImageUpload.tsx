import {
  type ChangeEvent, type ForwardedRef, forwardRef, type HTMLAttributes,
  type ReactElement, type Ref, useId, useImperativeHandle, useRef,
} from 'react';
import type { UploadPresetName } from '../../types';
import { useImageUploadContext } from '../context';
import { useClipboardPaste } from '../hooks/useClipboardPaste';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useSingleImageState } from '../hooks/useSingleImageState';
import type { SingleUploadSlot } from '../styling';
import type { ImageUploadHandle, SingleImageUploadProps } from '../types';
import {
  HIDDEN_INPUT_STYLE, resolveSlotClass, resolveSlotStyle, resolveUploadDataState,
} from '../utils/slotStyles';
import { AltTextModal } from './AltTextModal';
import { BlurVisualizationModal } from './BlurVisualizationModal';
import { PreviewTile } from './PreviewTile';
import { QualitySelector } from './QualitySelector';
import {
  resolveSingleDropzoneSlot, SingleDropzoneEmptyPrompt, SingleStatusFooter,
} from './SingleDropzoneContent';

function SingleImageUploadInner<TPreset extends string = UploadPresetName>(
  props: SingleImageUploadProps<TPreset>,
  ref: ForwardedRef<ImageUploadHandle>,
) {
  const {
    preset, translations, renderImage, label, error, helperText, className, style,
    accept = 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml',
    disabled = false, required = false, blurType = 'card',
    showProgress = false, showQualitySelector = true,
    recommendedQuality, qualityNote, isOpen,
    capture, enablePaste = true, pasteTarget = 'dropzone', name, onBlur,
    classNames: cCls, styles: cSty, renderDropzone, renderPreview,
  } = props;

  const ctx = useImageUploadContext();
  const isUnstyled = props.unstyled ?? ctx.unstyled;
  const pCls = ctx.singleClassNames;
  const pSty = ctx.singleStyles;

  const slotClass = (slot: SingleUploadSlot, defaultClass?: string) =>
    resolveSlotClass(defaultClass, isUnstyled, pCls?.[slot], cCls?.[slot]);
  const slotStyle = (slot: SingleUploadSlot) =>
    resolveSlotStyle(pSty?.[slot], cSty?.[slot]);

  const state = useSingleImageState(props);
  const { isDragging, dragHandlers } = useDragAndDrop({ disabled, onDrop: state.handleFileSelect });
  const { onPaste } = useClipboardPaste({
    enabled: enablePaste, pasteTarget, disabled, multiple: false,
    onPasteFiles: (files) => { void state.handleFileSelect(files); },
  });

  const dropzoneRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const inputId = useId();
  const statusTextId = useId();

  const openFileDialog = () => { if (!disabled) state.fileInputRef.current?.click(); };

  useImperativeHandle(ref, () => ({
    focus: () => { dropzoneRef.current?.focus(); },
    open: openFileDialog,
    clear: () => state.handleRemoveTile(),
  }));

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) void state.handleFileSelect(files);
    event.target.value = '';
  };

  const displayError = error || state.validationError;
  const hasPreview = Boolean(state.preview);
  const hasError = Boolean(displayError);
  const hasLabel = Boolean(label || state.ui.uploadImage);
  const hasStatusText = Boolean(helperText || displayError);
  const visualState = resolveUploadDataState({
    disabled, hasError, isUploading: state.isUploading, isDragging, hasContent: hasPreview,
  });

  const dropzoneProps: HTMLAttributes<HTMLElement> = hasPreview
    ? { ...dragHandlers, onPaste, 'aria-disabled': disabled || undefined }
    : {
        ...dragHandlers, onPaste,
        onClick: () => { if (!disabled) openFileDialog(); },
        onKeyDown: (event) => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openFileDialog();
          }
        },
        role: 'button', tabIndex: disabled ? -1 : 0,
        'aria-label': state.ui.uploadImageAria,
        'aria-labelledby': hasLabel ? labelId : undefined,
        'aria-required': required || undefined,
        'aria-invalid': hasError || undefined,
        'aria-describedby': hasStatusText ? statusTextId : undefined,
        'aria-disabled': disabled || undefined,
      };

  const slotStylingProps = {
    unstyled: isUnstyled, providerClassNames: pCls, classNames: cCls, providerStyles: pSty, styles: cSty,
  };
  const dropzoneSlot = resolveSingleDropzoneSlot(
    { isDragging, hasPreview, disabled, hasError }, slotStylingProps,
  );

  return (
    <div
      data-slot="single-root" data-state={visualState} data-unstyled={isUnstyled || undefined}
      className={resolveSlotClass('iuk-single', isUnstyled, pCls?.root, cCls?.root, className)}
      style={resolveSlotStyle(pSty?.root, cSty?.root, style)}
      dir={state.locale === 'ar' ? 'rtl' : 'ltr'}
      onBlur={onBlur ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur(); } : undefined}
    >
      <div role="status" aria-live="polite" aria-atomic="true" style={HIDDEN_INPUT_STYLE}>
        {state.liveAnnouncement}
      </div>

      {name && (
        <input type="hidden" name={name} value={state.serializedFormValue} required={required} data-slot="form-input" />
      )}

      {hasLabel && (
        <label id={labelId} htmlFor={inputId} data-slot="label" className={slotClass('label', 'iuk-label')} style={slotStyle('label')}>
          <span>{label || state.ui.uploadImage}</span>
          {required && <span className={resolveSlotClass('iuk-required', isUnstyled)}>*</span>}
        </label>
      )}

      {showQualitySelector && (
        <div data-slot="quality-selector" className={slotClass('qualitySelector')} style={slotStyle('qualitySelector')}>
          <QualitySelector
            value={state.qualityLevel} onChange={state.setQualityLevel} preset={preset}
            recommendedLevel={recommendedQuality} recommendationNote={qualityNote}
            originalFileSize={state.selectedFile?.size} locale={state.locale}
            disabled={disabled || state.isUploading} unstyled={isUnstyled}
          />
        </div>
      )}

      <input
        id={inputId} ref={state.fileInputRef} type="file" accept={accept} capture={capture}
        onChange={handleInputChange}
        className={resolveSlotClass('iuk-hidden-input', isUnstyled)}
        style={isUnstyled ? HIDDEN_INPUT_STYLE : undefined}
        disabled={disabled} aria-label={state.ui.fileInputAria}
        aria-invalid={hasError || undefined}
        aria-describedby={hasStatusText ? statusTextId : undefined}
      />

      {!state.preview && renderDropzone ? (
        renderDropzone({
          state: visualState, isDragging, isUploading: state.isUploading,
          progress: state.progress, uploadMessage: state.uploadMessage,
          maxSizeMB: state.maxSizeMB, disabled, error: displayError || undefined,
          qualityLevel: state.qualityLevel, setQualityLevel: state.setQualityLevel,
          openFileDialog, dropzoneProps, locale: state.locale, ui: state.ui,
        })
      ) : (
        <div
          ref={dropzoneRef} data-slot="dropzone" data-state={visualState}
          data-dragging={isDragging || undefined} data-uploading={state.isUploading || undefined}
          data-disabled={disabled || undefined} data-error={hasError || undefined}
          className={dropzoneSlot.className} style={dropzoneSlot.style} {...dropzoneProps}
        >
          {state.preview ? (
            <div
              data-slot="preview-wrap" className={slotClass('previewWrap', 'iuk-single__preview-wrap')}
              style={slotStyle('previewWrap')} onClick={(event) => event.stopPropagation()}
            >
              {renderPreview ? (
                renderPreview({
                  previewUrl: state.preview, uploadedData: state.uploadedData, altText: state.altText,
                  blurColor: state.uploadedData?.blurColor ?? state.blurColor,
                  blurDataUrl: state.blurDataUrlState || state.currentImageData?.blurDataUrl || '',
                  isUploading: state.isUploading, progress: state.progress,
                  uploadMessage: state.uploadMessage, sizeInfo: state.sizeInfo, disabled,
                  openFileDialog, remove: () => state.handleRemoveTile(),
                  cancel: () => state.handleCancelUpload(),
                  openAltTextModal: () => state.setEditingAltText(true),
                  openBlurInspector: () => state.setIsBlurModalOpen(true),
                  download: state.handleDownload, locale: state.locale, ui: state.ui,
                })
              ) : (
                <PreviewTile
                  preview={{
                    id: 'single', url: state.preview, altText: state.altText,
                    isUploading: state.isUploading, progress: state.progress,
                    uploadMessage: state.uploadMessage || null,
                    originalSize: state.sizeInfo?.original,
                    optimizedSize: state.sizeInfo?.optimized ?? null,
                    data: state.uploadedData ?? undefined,
                    blurColor: state.uploadedData?.blurColor ?? state.blurColor,
                  }}
                  onRemove={() => state.handleRemoveTile()} onCancel={() => state.handleCancelUpload()}
                  disabled={disabled} blurType={blurType} showCheckbox={false}
                  onEditAltText={() => state.setEditingAltText(true)}
                  onAdjustColor={() => state.setIsBlurModalOpen(true)}
                  locale={state.locale} translations={translations} renderImage={renderImage}
                  unstyled={isUnstyled} className={slotClass('tile')} style={slotStyle('tile')}
                />
              )}
            </div>
          ) : (
            <SingleDropzoneEmptyPrompt
              isUploading={state.isUploading} uploadMessage={state.uploadMessage}
              showProgress={showProgress} progress={state.progress}
              maxSizeMB={state.maxSizeMB} enablePaste={enablePaste} ui={state.ui} {...slotStylingProps}
            />
          )}
        </div>
      )}

      <SingleStatusFooter
        showMissingAltWarning={state.showMissingAltWarning}
        hasPreview={hasPreview} hasAltText={Boolean(state.altText?.trim())}
        uploadMessage={state.uploadMessage} isUploading={state.isUploading}
        sizeInfo={state.sizeInfo} canDownload={state.canDownload}
        onDownload={() => void state.handleDownload()}
        helperText={helperText} displayError={displayError} statusTextId={statusTextId}
        isOpen={isOpen} requireAltText={state.requireAltText}
        disabled={disabled} onSave={state.handleSaveImage}
        ui={state.ui} {...slotStylingProps}
      />

      {state.editingAltText && state.preview && (
        <AltTextModal
          imageUrl={state.preview} initialAltText={state.altText}
          onSave={state.handleAltTextSave} onClose={() => state.setEditingAltText(false)}
          locale={state.locale} translations={translations} renderImage={renderImage}
        />
      )}

      {state.preview && (
        <BlurVisualizationModal
          isOpen={state.isBlurModalOpen} onClose={() => state.setIsBlurModalOpen(false)}
          imageUrl={state.preview}
          blurDataUrl={state.blurDataUrlState || state.currentImageData?.blurDataUrl}
          blurColor={state.blurColor} altText={state.altText}
          originalSize={state.sizeInfo?.original ?? state.currentImageData?.originalSize}
          optimizedSize={state.sizeInfo?.optimized ?? state.currentImageData?.size ?? null}
          detectedColor={state.detectedBlurColor}
          onChangeColor={(hex) => state.applyBlurColor(hex)}
          onUseDetectedColor={state.handleResetColor}
          onChangeAltText={(nextAlt) => state.handleAltTextSave(nextAlt)}
          locale={state.locale} translations={translations} renderImage={renderImage}
        />
      )}
    </div>
  );
}

export const SingleImageUpload = forwardRef(SingleImageUploadInner) as <
  TPreset extends string = UploadPresetName,
>(
  props: SingleImageUploadProps<TPreset> & { ref?: Ref<ImageUploadHandle> },
) => ReactElement | null;

export default SingleImageUpload;
