import type { ComponentType, ReactNode } from 'react';
import type {
  MultiUploadReorderApi,
  NativeUploadAsset,
  TransformAssetFn,
  UploadMode,
} from '../client';
import type {
  CropStrategy,
  ImageAspectRatio,
  UploadedImageData,
  UploadLocale,
  UploadPresetName,
} from '../types';
import type { NativeResizeMode, NativeStyleProp } from './primitives';
import type { NativeUploadTheme } from './theme';

export type PickerPermissionSource = 'camera' | 'library';

export class PickerPermissionError extends Error {
  readonly source: PickerPermissionSource;

  constructor(
    source: PickerPermissionSource,
    message = `Permission denied for ${source === 'camera' ? 'camera' : 'media library'}`,
  ) {
    super(message);
    this.name = 'PickerPermissionError';
    this.source = source;
    Object.setPrototypeOf(this, PickerPermissionError.prototype);
  }
}

export interface NativeImagePickerOptions {
  multiple?: boolean;
  maxFiles?: number;
  quality?: number;
  aspectRatio?: ImageAspectRatio;
}

export interface NativeImagePickerAdapter {
  pickFromLibrary: (
    options?: NativeImagePickerOptions,
  ) => Promise<NativeUploadAsset[]>;
  takePhoto: (
    options?: NativeImagePickerOptions,
  ) => Promise<NativeUploadAsset[]>;
}

export interface NativeCustomUploadCallOptions {
  preset?: string;
  folder?: string;
  bucket?: string;
  altText?: string;
  customFilename?: string;
  quality?: number;
  aspectRatio?: ImageAspectRatio;
  crop?: CropStrategy;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export type NativeCustomUploaderFn = (
  asset: NativeUploadAsset,
  options: NativeCustomUploadCallOptions,
) => Promise<UploadedImageData>;

export type NativeCustomDeleterFn = (
  url: string,
  options?: { signal?: AbortSignal },
) => Promise<boolean>;

export interface NativeAnimatedImageSource {
  url: string;
  altText?: string | null;
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
  width?: number;
  height?: number;
}

export interface NativeAnimatedImageErrorContext {
  src: string;
  retry: () => void;
}

export interface NativeAnimatedImageProps {
  image?: NativeAnimatedImageSource | UploadedImageData;
  src?: string;
  alt?: string;
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
  colorPlaceholder?: 'flat' | 'gradient';
  neutralColors?: readonly string[];
  width?: number;
  height?: number;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  resizeMode?: NativeResizeMode;
  aspectRatio?: ImageAspectRatio;
  revealScale?: number;
  animationDuration?: number;
  reduceMotion?: boolean;
  fallbackSrc?: string;
  renderError?: (ctx: NativeAnimatedImageErrorContext) => ReactNode;
  as?: ComponentType<Record<string, unknown>>;
  imageComponentProps?: Record<string, unknown>;
  style?: NativeStyleProp;
  wrapperStyle?: NativeStyleProp;
  testID?: string;
  onLoad?: () => void;
  onError?: () => void;
}

export interface NativeUploadBaseProps {
  endpoint?: string;
  deleteEndpoint?: string;
  uploadMode?: UploadMode;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  preset?: UploadPresetName;
  folder?: string;
  bucket?: string;
  quality?: number;
  aspectRatio?: ImageAspectRatio;
  crop?: CropStrategy;
  maxSizeMB?: number;
  metadata?: Record<string, string>;
  transformAsset?: TransformAssetFn<NativeUploadAsset>;
  picker?: NativeImagePickerAdapter;
  customUploader?: NativeCustomUploaderFn;
  customDeleter?: NativeCustomDeleterFn;
  disabled?: boolean;
  reduceMotion?: boolean;
  locale?: UploadLocale;
  theme?: Partial<NativeUploadTheme>;
  style?: NativeStyleProp;
  testID?: string;
  onError?: (error: Error) => void;
}

export type NativeBaseUploadProps = NativeUploadBaseProps;

export interface NativeSingleImageUploadProps extends NativeUploadBaseProps {
  value?: UploadedImageData | null;
  defaultValue?: UploadedImageData | null;
  altText?: string;
  onChange?: (image: UploadedImageData | null) => void;
  onUploadComplete?: (image: UploadedImageData) => void;
}

export interface NativeMultiImageUploadProps extends NativeUploadBaseProps {
  value?: UploadedImageData[];
  defaultValue?: UploadedImageData[];
  maxImages?: number;
  maxParallelUploads?: number;
  reorderable?: boolean;
  showCoverBadge?: boolean;
  onChange?: (images: UploadedImageData[]) => void;
  onUploadComplete?: (images: UploadedImageData[]) => void;
  onReorder?: (images: UploadedImageData[]) => void;
}

export interface NativeMultiUploadItem {
  id: string;
  uri: string;
  asset?: NativeUploadAsset;
  isUploading: boolean;
  progress: number;
  error: string | null;
  data?: UploadedImageData;
}

export interface NativeMultiUploadReturn extends MultiUploadReorderApi {
  items: NativeMultiUploadItem[];
  images: UploadedImageData[];
  isUploading: boolean;
  error: string | null;
  canAddMore: boolean;
  pickFromLibrary: (
    options?: NativeImagePickerOptions,
  ) => Promise<UploadedImageData[]>;
  takePhoto: (
    options?: NativeImagePickerOptions,
  ) => Promise<UploadedImageData[]>;
  addAssets: (assets: NativeUploadAsset[]) => Promise<UploadedImageData[]>;
  removeItem: (id: string) => Promise<void>;
  cancelItem: (id: string) => void;
  retryItem: (id: string) => Promise<UploadedImageData | null>;
  clearAll: () => void;
}
