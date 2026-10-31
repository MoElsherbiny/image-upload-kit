import type { HTMLAttributes, InputHTMLAttributes } from 'react';
import type { UploadPresetName } from '../../types';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useSingleImageState } from '../hooks/useSingleImageState';
import { HIDDEN_INPUT_STYLE, resolveUploadDataState } from '../utils/slotStyles';
import type {
  HeadlessDropzoneProps,
  HeadlessFileInputProps,
  SingleUploadController,
  UseSingleUploadOptions,
} from './types';

const DEFAULT_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml';

export function useSingleUpload<TPreset extends string = UploadPresetName>(
  options: UseSingleUploadOptions<TPreset>,
): SingleUploadController {
  const { accept = DEFAULT_ACCEPT, disabled = false, error: externalError } = options;

  const {
    locale, ui, maxSizeMB, fileInputRef, preview, altText, blurColor,
    detectedBlurColor, blurDataUrlState, validationError, sizeInfo,
    uploadedData, qualityLevel, setQualityLevel, isUploading, progress,
    uploadMessage, currentImageData, canDownload, applyBlurColor,
    handleResetColor, handleFileSelect, handleRemoveTile,
    handleAltTextSave, handleSaveImage, handleDownload,
  } = useSingleImageState(options);

  const { isDragging, dragHandlers } = useDragAndDrop({
    disabled,
    onDrop: (files) => { void handleFileSelect(files); },
  });

  const displayError = externalError || validationError || '';
  const blurDataUrl = blurDataUrlState || currentImageData?.blurDataUrl || '';

  const state = resolveUploadDataState({
    disabled,
    hasError: Boolean(displayError),
    isUploading,
    isDragging,
    hasContent: Boolean(preview),
  });

  const openFileDialog = () => {
    if (!disabled) fileInputRef.current?.click();
  };

  const getDropzoneProps = (
    overrides?: HTMLAttributes<HTMLElement>,
  ): HeadlessDropzoneProps => ({
    ...overrides,
    role: overrides?.role ?? 'button',
    tabIndex: overrides?.tabIndex ?? (disabled ? -1 : 0),
    'aria-label': overrides?.['aria-label'] ?? ui.uploadImageAria,
    'aria-disabled': disabled || undefined,
    'data-state': state,
    'data-dragging': isDragging || undefined,
    'data-uploading': isUploading || undefined,
    'data-disabled': disabled || undefined,
    'data-error': Boolean(displayError) || undefined,
    onClick: (event) => {
      if (event.target === fileInputRef.current) return;
      overrides?.onClick?.(event);
      if (!event.defaultPrevented && !disabled) openFileDialog();
    },
    onKeyDown: (event) => {
      overrides?.onKeyDown?.(event);
      if (
        !event.defaultPrevented &&
        !disabled &&
        event.target === event.currentTarget &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault();
        openFileDialog();
      }
    },
    onDragEnter: (event) => { overrides?.onDragEnter?.(event); dragHandlers.onDragEnter(event); },
    onDragLeave: (event) => { overrides?.onDragLeave?.(event); dragHandlers.onDragLeave(event); },
    onDragOver: (event) => { overrides?.onDragOver?.(event); dragHandlers.onDragOver(event); },
    onDrop: (event) => { overrides?.onDrop?.(event); dragHandlers.onDrop(event); },
  });

  const getInputProps = (
    overrides?: InputHTMLAttributes<HTMLInputElement>,
  ): HeadlessFileInputProps => ({
    ...overrides,
    ref: fileInputRef,
    type: 'file',
    accept: overrides?.accept ?? accept,
    disabled: overrides?.disabled ?? disabled,
    'aria-label': overrides?.['aria-label'] ?? ui.fileInputAria,
    style: overrides?.style ? { ...HIDDEN_INPUT_STYLE, ...overrides.style } : HIDDEN_INPUT_STYLE,
    onClick: (event) => {
      overrides?.onClick?.(event);
      event.stopPropagation();
    },
    onChange: (event) => {
      overrides?.onChange?.(event);
      if (!event.defaultPrevented) {
        const files = event.target.files;
        if (files && files.length > 0) void handleFileSelect(files);
        event.target.value = '';
      }
    },
  });

  return {
    state, preview, uploadedData, altText, blurColor, detectedBlurColor,
    blurDataUrl, isDragging, isUploading, progress, uploadMessage,
    error: displayError, sizeInfo, qualityLevel, maxSizeMB, disabled,
    canDownload, locale, ui, openFileDialog,
    selectFiles: handleFileSelect,
    remove: handleRemoveTile,
    save: handleSaveImage,
    download: handleDownload,
    setQualityLevel,
    setAltText: handleAltTextSave,
    setBlurColor: (hex: string) => applyBlurColor(hex),
    resetBlurColor: handleResetColor,
    getDropzoneProps,
    getInputProps,
  };
}
