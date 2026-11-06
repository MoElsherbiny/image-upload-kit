import type {
  MultiUploadReorderApi,
  TransformAssetFn,
  UploadableAsset,
} from '../client';
import type {
  CropStrategy,
  ExplicitOutputFormat,
  ImageAspectRatio,
  ImageDimensions,
  ImageVariant,
  QualityLevel,
  UploadedImageData,
  UploadLocale,
  UploadPresetName,
} from '../types';

export type UploadVisualState =
  | 'idle'
  | 'dragging'
  | 'uploading'
  | 'ready'
  | 'error'
  | 'disabled';

export type AnimatedImageObjectFit =
  | 'cover'
  | 'contain'
  | 'fill'
  | 'none'
  | 'scale-down';

export type AnimatedImageColorPlaceholder = 'flat' | 'gradient';

export interface AnimatedImageSource {
  url: string;
  altText?: string | null;
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
  width?: number;
  height?: number;
  variants?: ImageVariant[];
  srcSet?: string;
}

export interface AngularSignal<T> {
  (): T;
  set: (value: T) => void;
  update: (updater: (prev: T) => T) => void;
  subscribe: (listener: (value: T) => void) => () => void;
  asReadonly: () => AngularComputed<T>;
}

export interface AngularComputed<T> {
  (): T;
  subscribe: (listener: (value: T) => void) => () => void;
}

export interface ControlValueAccessorShape<T> {
  writeValue: (val: T) => void;
  registerOnChange: (fn: (val: T) => void) => void;
  registerOnTouched: (fn: () => void) => void;
  setDisabledState?: (isDisabled: boolean) => void;
}

export interface AngularUploadRequestParams {
  preset?: string;
  folder?: string;
  bucket?: string;
  altText?: string;
  customFilename?: string;
  outputFormat?: ExplicitOutputFormat;
  quality?: number;
  maxDimensions?: ImageDimensions;
  aspectRatio?: Exclude<ImageAspectRatio, 'auto'>;
  crop?: CropStrategy;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
  onUploadProgress?: (percent: number) => void;
}

export type CustomUploaderFn = (
  file: File,
  params: AngularUploadRequestParams,
) => Promise<UploadedImageData>;

export type CustomDeleterFn = (data: UploadedImageData | string) => Promise<void>;

export interface ImageUploadAngularConfig {
  endpoint?: string;
  deleteEndpoint?: string;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  defaultPreset?: UploadPresetName;
  locale?: UploadLocale;
  customUploader?: CustomUploaderFn;
  uploader?: CustomUploaderFn;
  customDeleter?: CustomDeleterFn;
  storageKeyPrefix?: string;
  requireAltText?: boolean;
  unstyled?: boolean;
}

export interface AngularUploadStatus {
  message: string;
  progress: number;
}

export interface AngularBaseUploadOptions<TPreset extends string = UploadPresetName> {
  preset?: TPreset;
  folder?: string;
  bucket?: string;
  metadata?: Record<string, string>;
  endpoint?: string;
  deleteEndpoint?: string;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  locale?: UploadLocale;
  maxSizeMB?: number;
  maxDimensions?: ImageDimensions;
  allowedFormats?: string[];
  accept?: string;
  outputFormat?: ExplicitOutputFormat;
  quality?: number | QualityLevel;
  customFilename?: string;
  aspectRatio?: ImageAspectRatio;
  crop?: CropStrategy;
  disabled?: boolean;
  unstyled?: boolean;
  label?: string;
  helperText?: string;
  error?: string;
  transformAsset?: TransformAssetFn<File>;
  customUploader?: CustomUploaderFn;
  uploader?: CustomUploaderFn;
  customDeleter?: CustomDeleterFn;
  onError?: (error: string) => void;
  onBlur?: () => void;
}

export interface AngularSingleUploadOptions<
  TPreset extends string = UploadPresetName,
> extends AngularBaseUploadOptions<TPreset> {
  value?: UploadedImageData | string | null;
  initialAltText?: string;
  showProgress?: boolean;
  onChange?: (data: UploadedImageData | null) => void;
  onUploadStart?: (file: File) => void;
  onUploadComplete?: (data: UploadedImageData) => void;
}

export interface AngularMultiUploadItem {
  id: string;
  url: string;
  file?: File | null;
  fileName?: string;
  data?: UploadedImageData;
  altText?: string;
  blurColor?: string;
  isUploading: boolean;
  progress: number;
  error?: string;
  uploadMessage?: string | null;
  originalSize?: number;
  optimizedSize?: number | null;
}

export interface AngularMultiUploadOptions<
  TPreset extends string = UploadPresetName,
> extends AngularBaseUploadOptions<TPreset> {
  value?: UploadedImageData[];
  maxFiles?: number;
  maxImages?: number;
  minImages?: number;
  maxParallelUploads?: number;
  reorderable?: boolean;
  showCoverBadge?: boolean;
  coverBadgeLabel?: string;
  onChange?: (images: UploadedImageData[]) => void;
  onReorder?: (
    images: UploadedImageData[],
    detail: { fromIndex: number; toIndex: number },
  ) => void;
  onUploadStart?: (files: File[]) => void;
  onUploadComplete?: (results: UploadedImageData[]) => void;
  onUploadCancel?: (id: string) => void;
}

export interface AngularImageRevealOptions {
  image?: AnimatedImageSource;
  src?: string;
  fallbackSrc?: string;
  blurDataUrl?: string | null;
  blurHash?: string | null;
  blurColor?: string | null;
  colorPlaceholder?: AnimatedImageColorPlaceholder;
  neutralColors?: readonly string[];
  objectFit?: AnimatedImageObjectFit;
  animationDuration?: number;
  onLoad?: (img: HTMLImageElement | null) => void;
  onError?: () => void;
}

export interface AngularAnimatedImageOptions extends AngularImageRevealOptions {
  alt?: string;
  width?: number;
  height?: number;
  aspectRatio?: ImageAspectRatio;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  objectPosition?: string;
  showShimmer?: boolean;
  revealScale?: number;
  srcSet?: string;
  sizes?: string;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  draggable?: boolean;
  unstyled?: boolean;
  wrapperClassName?: string;
  wrapperStyle?: Record<string, string | number | undefined>;
  placeholderClassName?: string;
  className?: string;
  style?: Record<string, string | number | undefined>;
  renderError?: (ctx: { src: string; retry: () => void }) => HTMLElement | string | null;
}

export type { MultiUploadReorderApi, TransformAssetFn, UploadableAsset };
