import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { QualityLevel, UploadedImageData, UploadLocale } from '../types';
import type { UploadTranslations } from './i18n';
import type { ImagePreview } from './types';

export type UploadVisualState =
  | 'idle'
  | 'dragging'
  | 'uploading'
  | 'ready'
  | 'error'
  | 'disabled';

export type SingleUploadSlot =
  | 'root'
  | 'label'
  | 'qualitySelector'
  | 'dropzone'
  | 'dropzoneDragging'
  | 'dropzoneHasImage'
  | 'dropzoneDisabled'
  | 'dropzoneError'
  | 'dropzonePrompt'
  | 'dropzoneIcon'
  | 'dropzoneText'
  | 'dropzoneHint'
  | 'dropzoneProgress'
  | 'browseButton'
  | 'previewWrap'
  | 'tile'
  | 'downloadButton'
  | 'alert'
  | 'helperText'
  | 'errorText'
  | 'commitBar'
  | 'saveButton';

export type MultiUploadSlot =
  | 'root'
  | 'header'
  | 'label'
  | 'count'
  | 'bulkActions'
  | 'bulkButton'
  | 'bulkDangerButton'
  | 'qualitySelector'
  | 'emptyDropzone'
  | 'emptyDropzoneDragging'
  | 'emptyDropzoneDisabled'
  | 'emptyDropzoneError'
  | 'emptyTitle'
  | 'emptyHint'
  | 'emptyActions'
  | 'primaryButton'
  | 'secondaryButton'
  | 'emptySubtext'
  | 'grid'
  | 'tile'
  | 'addMoreTile'
  | 'addMoreTileDragging'
  | 'addMoreContent'
  | 'addMoreActions'
  | 'alert'
  | 'helperText'
  | 'errorText'
  | 'commitBar'
  | 'saveButton';

export type SingleUploadClassNames = Partial<Record<SingleUploadSlot, string>>;
export type SingleUploadStyles = Partial<Record<SingleUploadSlot, CSSProperties>>;

export type MultiUploadClassNames = Partial<Record<MultiUploadSlot, string>>;
export type MultiUploadStyles = Partial<Record<MultiUploadSlot, CSSProperties>>;

export interface SingleDropzoneRenderContext {
  state: UploadVisualState;
  isDragging: boolean;
  isUploading: boolean;
  progress: number;
  uploadMessage: string;
  maxSizeMB: number;
  disabled: boolean;
  error?: string;
  qualityLevel: QualityLevel;
  setQualityLevel: (level: QualityLevel) => void;
  openFileDialog: () => void;
  dropzoneProps: HTMLAttributes<HTMLElement>;
  locale: UploadLocale;
  ui: UploadTranslations;
}

export interface SinglePreviewRenderContext {
  previewUrl: string;
  uploadedData: UploadedImageData | null;
  altText: string;
  blurColor: string;
  blurDataUrl: string;
  isUploading: boolean;
  progress: number;
  uploadMessage: string;
  sizeInfo: { original: number; optimized: number } | null;
  disabled: boolean;
  openFileDialog: () => void;
  remove: () => void;
  cancel: () => void;
  openAltTextModal: () => void;
  openBlurInspector: () => void;
  download: () => Promise<void>;
  locale: UploadLocale;
  ui: UploadTranslations;
}

export interface MultiHeaderRenderContext {
  label?: string;
  required: boolean;
  disabled: boolean;
  totalCount: number;
  selectedCount: number;
  uploadingCount: number;
  isUploading: boolean;
  hasFailedUploads: boolean;
  selectAll: () => void;
  clearSelection: () => void;
  removeSelected: () => void;
  retryFailed: () => void;
  locale: UploadLocale;
  ui: UploadTranslations;
}

export interface MultiEmptyRenderContext {
  state: UploadVisualState;
  isDragging: boolean;
  disabled: boolean;
  allowFolder: boolean;
  maxSizeMB: number;
  maxImages: number;
  error?: string;
  openFileDialog: () => void;
  openFolderDialog: () => void;
  dropzoneProps: HTMLAttributes<HTMLElement>;
  locale: UploadLocale;
  ui: UploadTranslations;
}

export interface MultiTileRenderContext {
  item: ImagePreview;
  index: number;
  isCover?: boolean;
  isSelected: boolean;
  disabled: boolean;
  toggleSelect: () => void;
  remove: () => void;
  cancel: () => void;
  retry: () => void;
  moveEarlier?: () => void;
  moveLater?: () => void;
  setAsCover?: () => void;
  openAltTextModal: () => void;
  setAltText: (altText: string) => void;
  setBlurColor: (hex: string) => void;
  locale: UploadLocale;
  ui: UploadTranslations;
}

export interface MultiAddMoreRenderContext {
  isDragging: boolean;
  disabled: boolean;
  allowFolder: boolean;
  remainingCount: number;
  openFileDialog: () => void;
  openFolderDialog: () => void;
  dropzoneProps: HTMLAttributes<HTMLElement>;
  locale: UploadLocale;
  ui: UploadTranslations;
}

export interface SingleCustomRenderers {
  /** Replace the empty/uploading dropzone UI with custom JSX while preserving upload & drag behavior */
  renderDropzone?: (ctx: SingleDropzoneRenderContext) => ReactNode;
  /** Replace the uploaded image preview tile with custom JSX while preserving alt/blur modal actions */
  renderPreview?: (ctx: SinglePreviewRenderContext) => ReactNode;
}

export interface MultiCustomRenderers {
  /** Replace the multi-upload header & bulk action toolbar with custom JSX */
  renderHeader?: (ctx: MultiHeaderRenderContext) => ReactNode;
  /** Replace the initial empty multi-upload dropzone with custom JSX */
  renderEmptyDropzone?: (ctx: MultiEmptyRenderContext) => ReactNode;
  /** Replace individual image preview cards inside the multi-upload grid */
  renderTile?: (ctx: MultiTileRenderContext) => ReactNode;
  /** Replace the trailing "Add More" tile inside the multi-upload grid (return `null` to hide) */
  renderAddMore?: (ctx: MultiAddMoreRenderContext) => ReactNode;
}
