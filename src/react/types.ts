import type { CSSProperties, ReactNode } from 'react';
import type { BlurPlaceholderType } from '../blur/types';
import type {
  ExplicitOutputFormat,
  ImageDimensions,
  QualityLevel,
  UploadedImageData,
  UploadLocale,
  UploadPresetName,
} from '../types';
import type { UploadTranslations } from './i18n';
import type {
  MultiCustomRenderers,
  MultiUploadClassNames,
  MultiUploadStyles,
  SingleCustomRenderers,
  SingleUploadClassNames,
  SingleUploadStyles,
} from './styling';

export * from './styling';

export interface RenderImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  onLoad?: (img: HTMLImageElement | null) => void;
}

export type CustomImageRenderer = (props: RenderImageProps) => ReactNode;

export interface ClientUploadRequestParams {
  preset?: string;
  folder?: string;
  bucket?: string;
  altText?: string;
  customFilename?: string;
  outputFormat?: ExplicitOutputFormat;
  quality?: number;
  maxDimensions?: ImageDimensions;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
  onUploadProgress?: (percent: number) => void;
}

export type CustomUploaderFn = (
  file: File,
  params: ClientUploadRequestParams,
) => Promise<UploadedImageData>;

export interface BaseImageUploadProps<
  TPreset extends string = UploadPresetName,
> {
  /** Optional named preset (e.g. 'avatar', 'hero', or a custom project preset) */
  preset?: TPreset;
  /** Optional storage folder path (e.g. 'products/42' or 'users/avatars') */
  folder?: string;
  /** Optional target storage bucket */
  bucket?: string;
  /** Arbitrary project-specific metadata sent with the upload (e.g. { entityId: '42', scope: 'catalog' }) */
  metadata?: Record<string, string>;
  /** Server upload endpoint URL (defaults to '/api/upload' when `uploader` is not provided) */
  endpoint?: string;
  /** Custom async upload function (bypasses HTTP `endpoint` when provided) */
  uploader?: CustomUploaderFn;
  /** Additional HTTP headers sent with FormData requests to `endpoint` */
  headers?: Record<string, string>;
  /** Send cookies/credentials with FormData requests (`'same-origin' | 'include' | 'omit'`) */
  withCredentials?: boolean;
  /** UI language ('en' | 'ar'). Auto-detects RTL layout for 'ar'. */
  locale?: UploadLocale;
  /** Optional partial translation overrides */
  translations?: Partial<UploadTranslations>;
  /** Custom image renderer (e.g. wrap Next.js `<Image />` or custom CDN loader) */
  renderImage?: CustomImageRenderer;
  /** Field label */
  label?: string;
  /** Maximum file size in MB (defaults to preset maxSizeMB or 10) */
  maxSizeMB?: number;
  /** Maximum bounding box dimensions sent to the server */
  maxDimensions?: ImageDimensions;
  /** Accepted MIME types string for `<input type="file" accept="..." />` */
  accept?: string;
  /** Disable interactions */
  disabled?: boolean;
  /** External validation error message */
  error?: string;
  /** Helper text displayed below the uploader */
  helperText?: string;
  /** Show required asterisk next to label */
  required?: boolean;
  /** Require non-empty alt text before saving in modal mode (defaults to `true`) */
  requireAltText?: boolean;
  /** Custom wrapper className */
  className?: string;
  /** Custom wrapper inline style */
  style?: CSSProperties;
  /**
   * Strip built-in `iuk-*` visual classes so you can style every slot cleanly
   * with Tailwind CSS, CSS Modules, or custom stylesheets without specificity overrides.
   */
  unstyled?: boolean;
  /** Fallback blur placeholder style variant */
  blurType?: BlurPlaceholderType;
  /** Show numeric upload percentage inside single dropzone */
  showProgress?: boolean;
  /** Show compression `<QualitySelector />` (defaults to `true`) */
  showQualitySelector?: boolean;
  /** Recommended quality level highlighted in `<QualitySelector />` */
  recommendedQuality?: QualityLevel;
  /** Optional guidance note shown inside `<QualitySelector />` */
  qualityNote?: { en: string; ar?: string };
  /** Modal title mode ('create' | 'edit') */
  modeVariant?: 'create' | 'edit';
  /** When defined (`true`/`false`), renders inside a minimizable modal dialog */
  isOpen?: boolean;
  /** Close callback for modal mode */
  onClose?: () => void;
  /** Modal header title */
  title?: string;
  /** Explicit output format ('avif' | 'webp' | 'jpeg' | 'png') */
  outputFormat?: ExplicitOutputFormat;
  /** Initial compression quality (1–100) */
  quality?: number;
  /** Custom filename target in storage */
  customFilename?: string;
}

export interface SingleImageUploadProps<
  TPreset extends string = UploadPresetName,
> extends BaseImageUploadProps<TPreset>,
    SingleCustomRenderers {
  mode?: 'single';
  value?: string | UploadedImageData | null;
  onChange: (data: UploadedImageData | null) => void;
  initialAltText?: string;
  /** Per-slot custom CSS classes (Tailwind, CSS Modules, BEM) for SingleImageUpload */
  classNames?: SingleUploadClassNames;
  /** Per-slot inline CSS styles for SingleImageUpload */
  styles?: SingleUploadStyles;
}

export interface MultiImageUploadProps<
  TPreset extends string = UploadPresetName,
> extends BaseImageUploadProps<TPreset>,
    MultiCustomRenderers {
  mode: 'multiple';
  value?: UploadedImageData[];
  onChange: (images: UploadedImageData[]) => void;
  maxImages?: number;
  allowFolder?: boolean;
  maxParallelUploads?: number;
  /** Per-slot custom CSS classes (Tailwind, CSS Modules, BEM) for MultiImageUpload */
  classNames?: MultiUploadClassNames;
  /** Per-slot inline CSS styles for MultiImageUpload */
  styles?: MultiUploadStyles;
}

export type ImageUploadProps<TPreset extends string = UploadPresetName> =
  | SingleImageUploadProps<TPreset>
  | MultiImageUploadProps<TPreset>;

export interface ImagePreview {
  id: string;
  url: string;
  file?: File | null;
  data?: UploadedImageData;
  altText?: string;
  blurColor?: string;
  isUploading?: boolean;
  progress?: number;
  error?: string;
  uploadMessage?: string | null;
  originalSize?: number;
  optimizedSize?: number | null;
  fileName?: string;
}

export interface UploadStatus {
  message: string;
  progress: number;
}

export interface SizeInfo {
  original: number;
  optimized: number;
  reduction: number;
}
