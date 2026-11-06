import type { CropStrategy, ImageAspectRatio } from '../types/aspectRatio';
import type { ExplicitOutputFormat, ImageDimensions } from '../types/quality';

/**
 * File asset descriptor produced by React Native / Expo image pickers
 * (`expo-image-picker`, `react-native-image-picker`, camera rolls).
 */
export interface NativeUploadAsset {
  /** Local `file://`, `content://`, `ph://`, or `data:` URI */
  uri: string;
  /** Optional filename (e.g. `'photo.jpg'`); synthesized from `uri`/`type` when omitted */
  name?: string;
  /** Optional MIME type (e.g. `'image/jpeg'`); inferred from extension when omitted */
  type?: string;
  /** Optional file size in bytes (`fileSize` alias also supported by pickers) */
  size?: number;
  /** Intrinsic pixel width if reported by the native picker */
  width?: number;
  /** Intrinsic pixel height if reported by the native picker */
  height?: number;
}

export type ReactNativeUploadAsset = NativeUploadAsset;

/**
 * Universal client upload asset accepted across Web (`File` / `Blob`)
 * and React Native (`NativeUploadAsset`).
 */
export type UploadableAsset = File | Blob | NativeUploadAsset;

export type UploadPhase =
  | 'queued'
  | 'transforming'
  | 'uploading'
  | 'processing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface TransformAssetContext {
  signal: AbortSignal;
  preset?: string;
  index: number;
}

export type TransformAssetFn<
  TAsset extends UploadableAsset = UploadableAsset,
> = (asset: TAsset, context: TransformAssetContext) => Promise<TAsset>;

export interface MultiUploadReorderApi {
  /** Move an image from `fromIndex` to `toIndex` */
  move: (fromIndex: number, toIndex: number) => void;
  /** Promote the image at `index` to position `0` (the primary cover image) */
  setCover: (index: number) => void;
  /** Alias for `setCover(index)` */
  setPrimary: (index: number) => void;
}

export interface ClientUploadFormFields {
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
}
