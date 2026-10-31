import { type HTMLAttributes, type InputHTMLAttributes, type RefObject, useRef } from 'react';
import type { UploadPresetName } from '../../types';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useMultiImageState } from '../hooks/useMultiImageState';
import { HIDDEN_INPUT_STYLE, resolveUploadDataState } from '../utils/slotStyles';
import type {
  HeadlessDropzoneProps,
  HeadlessFileInputProps,
  MultiUploadController,
  UseMultiUploadOptions,
} from './types';

const DEFAULT_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml';

export function useMultiUpload<TPreset extends string = UploadPresetName>(
  options: UseMultiUploadOptions<TPreset>,
): MultiUploadController {
  const {
    accept = DEFAULT_ACCEPT,
    disabled = false,
    error: externalError,
    maxImages = 999,
  } = options;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const {
    locale, ui, maxSizeMB, previews, validationError, infoMessage,
    selectedPreviews, setSelectedPreviews, uploadStats, qualityLevel,
    setQualityLevel, isUploading, hasFailedUploads, uploadingPreviews,
    completedPreviews, handleFileSelect, handleRemove, handleRemoveSelected,
    toggleSelect, handleRetryFailed, handleAltTextSave, handleColorChange,
    handleSaveImages,
  } = useMultiImageState(options);

  const { isDragging, dragHandlers } = useDragAndDrop({
    disabled,
    onDrop: (files) => { void handleFileSelect(files); },
  });

  const displayError = externalError || validationError || '';
  const remainingCount = Math.max(0, maxImages - previews.length);

  const state = resolveUploadDataState({
    disabled,
    hasError: Boolean(displayError),
    isUploading,
    isDragging,
    hasContent: previews.length > 0,
  });

  const openFileDialog = () => { if (!disabled) fileInputRef.current?.click(); };
  const openFolderDialog = () => { if (!disabled) folderInputRef.current?.click(); };

  const getDropzoneProps = (
    overrides?: HTMLAttributes<HTMLElement>,
  ): HeadlessDropzoneProps => ({
    ...overrides,
    role: overrides?.role ?? 'button',
    tabIndex: overrides?.tabIndex ?? (disabled ? -1 : 0),
    'aria-label': overrides?.['aria-label'] ?? ui.selectFilesAria,
    'aria-disabled': disabled || undefined,
    'data-state': state,
    'data-dragging': isDragging || undefined,
    'data-uploading': isUploading || undefined,
    'data-disabled': disabled || undefined,
    'data-error': Boolean(displayError) || undefined,
    onClick: (event) => {
      if (event.target === fileInputRef.current || event.target === folderInputRef.current) return;
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

  const buildInputProps = (
    ref: RefObject<HTMLInputElement | null>,
    defaultAriaLabel: string,
    isFolder: boolean,
    overrides?: InputHTMLAttributes<HTMLInputElement>,
  ): HeadlessFileInputProps => ({
    ...overrides,
    ...(isFolder ? { webkitdirectory: '', directory: '' } : {}),
    ref,
    type: 'file',
    multiple: overrides?.multiple ?? true,
    accept: overrides?.accept ?? accept,
    disabled: overrides?.disabled ?? disabled,
    'aria-label': overrides?.['aria-label'] ?? defaultAriaLabel,
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
    state,
    items: previews,
    completedItems: completedPreviews,
    uploadingItems: uploadingPreviews,
    selectedIds: selectedPreviews,
    stats: uploadStats,
    isDragging, isUploading, hasFailedUploads,
    error: displayError, infoMessage, qualityLevel,
    maxSizeMB, maxImages, remainingCount, disabled, locale, ui,
    openFileDialog, openFolderDialog,
    selectFiles: handleFileSelect,
    remove: handleRemove,
    removeSelected: handleRemoveSelected,
    toggleSelect,
    selectAll: () => setSelectedPreviews(new Set(previews.map((p) => p.id))),
    clearSelection: () => setSelectedPreviews(new Set()),
    retryFailed: handleRetryFailed,
    save: handleSaveImages,
    setQualityLevel,
    setAltText: handleAltTextSave,
    setBlurColor: handleColorChange,
    getDropzoneProps,
    getInputProps: (overrides) => buildInputProps(fileInputRef, ui.selectFilesAria, false, overrides),
    getFolderInputProps: (overrides) => buildInputProps(folderInputRef, ui.selectFolderAria, true, overrides),
  };
}
