import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
} from 'react';
import type {
  QualityLevel,
  UploadedImageData,
  UploadLocale,
  UploadPresetName,
} from '../../types';
import type { MultiUploadStats } from '../hooks/useMultiImageState';
import type { UploadTranslations } from '../i18n';
import type { UploadVisualState } from '../styling';
import type {
  ImagePreview,
  ImageUploadHandle,
  MultiImageUploadProps,
  SingleImageUploadProps,
} from '../types';

export type { ImageUploadHandle, MultiUploadStats };

export interface HeadlessDropzoneProps extends HTMLAttributes<HTMLElement> {
  [key: `data-${string}`]: unknown;
}

export interface HeadlessFileInputProps
  extends InputHTMLAttributes<HTMLInputElement> {
  ref: Ref<HTMLInputElement>;
  webkitdirectory?: string;
  directory?: string;
}

export type UseSingleUploadOptions<
  TPreset extends string = UploadPresetName,
> = SingleImageUploadProps<TPreset>;

export interface SingleUploadController {
  state: UploadVisualState;
  preview: string | null;
  uploadedData: UploadedImageData | null;
  altText: string;
  blurColor: string;
  detectedBlurColor: string;
  blurDataUrl: string;
  isDragging: boolean;
  isUploading: boolean;
  progress: number;
  uploadMessage: string;
  error: string;
  sizeInfo: { original: number; optimized: number } | null;
  qualityLevel: QualityLevel;
  maxSizeMB: number;
  disabled: boolean;
  canDownload: boolean;
  locale: UploadLocale;
  ui: UploadTranslations;
  openFileDialog: () => void;
  selectFiles: (files: FileList) => Promise<void>;
  remove: () => void;
  cancel: () => void;
  cancelUpload: () => void;
  save: () => void;
  download: () => Promise<void>;
  setQualityLevel: (level: QualityLevel) => void;
  setAltText: (altText: string) => void;
  setBlurColor: (hex: string) => void;
  resetBlurColor: () => void;
  getDropzoneProps: (
    overrides?: HTMLAttributes<HTMLElement>,
  ) => HeadlessDropzoneProps;
  getInputProps: (
    overrides?: InputHTMLAttributes<HTMLInputElement>,
  ) => HeadlessFileInputProps;
}

export type UseMultiUploadOptions<TPreset extends string = UploadPresetName> =
  Omit<MultiImageUploadProps<TPreset>, 'mode'> & { mode?: 'multiple' };

export interface MultiUploadController {
  state: UploadVisualState;
  items: ImagePreview[];
  completedItems: ImagePreview[];
  uploadingItems: ImagePreview[];
  selectedIds: Set<string>;
  stats: MultiUploadStats;
  isDragging: boolean;
  isUploading: boolean;
  hasFailedUploads: boolean;
  error: string;
  infoMessage: string;
  qualityLevel: QualityLevel;
  maxSizeMB: number;
  maxImages: number;
  remainingCount: number;
  disabled: boolean;
  locale: UploadLocale;
  ui: UploadTranslations;
  openFileDialog: () => void;
  openFolderDialog: () => void;
  selectFiles: (files: FileList) => Promise<void>;
  remove: (id: string) => void;
  removeSelected: () => void;
  clear: () => void;
  cancel: (id: string) => void;
  cancelUpload: (id: string) => void;
  retry: (id: string) => Promise<void>;
  retryUpload: (id: string) => Promise<void>;
  retryAll: () => Promise<void>;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  retryFailed: () => Promise<void>;
  save: () => void;
  setQualityLevel: (level: QualityLevel) => void;
  setAltText: (id: string, altText: string) => void;
  setBlurColor: (id: string, hex: string) => void;
  getDropzoneProps: (
    overrides?: HTMLAttributes<HTMLElement>,
  ) => HeadlessDropzoneProps;
  getInputProps: (
    overrides?: InputHTMLAttributes<HTMLInputElement>,
  ) => HeadlessFileInputProps;
  getFolderInputProps: (
    overrides?: InputHTMLAttributes<HTMLInputElement>,
  ) => HeadlessFileInputProps;
}

export type HeadlessSingleUploadProps<
  TPreset extends string = UploadPresetName,
> = UseSingleUploadOptions<TPreset> & {
  children: (controller: SingleUploadController) => ReactNode;
};

export type HeadlessMultiUploadProps<
  TPreset extends string = UploadPresetName,
> = UseMultiUploadOptions<TPreset> & {
  children: (controller: MultiUploadController) => ReactNode;
};
