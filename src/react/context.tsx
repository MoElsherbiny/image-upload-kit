import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { UploadMode } from '../client/types';
import type { UploadLocale } from '../types';
import type { UploadTranslations } from './i18n';
import type {
  MultiUploadClassNames,
  MultiUploadStyles,
  SingleUploadClassNames,
  SingleUploadStyles,
} from './styling';
import type {
  CustomDeleterFn,
  CustomImageRenderer,
  CustomUploaderFn,
} from './types';

export interface ImageUploadContextValue {
  endpoint: string;
  deleteEndpoint?: string;
  uploader?: CustomUploaderFn;
  customDeleter?: CustomDeleterFn;
  uploadMode?: UploadMode;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  renderImage?: CustomImageRenderer;
  storageKeyPrefix: string;
  requireAltText: boolean;
  unstyled: boolean;
  singleClassNames?: SingleUploadClassNames;
  singleStyles?: SingleUploadStyles;
  multiClassNames?: MultiUploadClassNames;
  multiStyles?: MultiUploadStyles;
}

const DEFAULT_CONTEXT: ImageUploadContextValue = {
  endpoint: '/api/upload',
  locale: undefined,
  storageKeyPrefix: 'iuk',
  requireAltText: true,
  unstyled: false,
};

const ImageUploadContext =
  createContext<ImageUploadContextValue>(DEFAULT_CONTEXT);

export interface ImageUploadProviderProps {
  children: ReactNode;
  /** Default server endpoint for uploads (defaults to `'/api/upload'`) */
  endpoint?: string;
  /** Optional server endpoint for opt-in `DELETE` requests when an uploaded image is removed */
  deleteEndpoint?: string;
  /** Custom async uploader function used across all upload components */
  uploader?: CustomUploaderFn;
  /** Custom async deleter function invoked when an uploaded image is removed */
  customDeleter?: CustomDeleterFn;
  /** Upload transport mode (`'direct'` or `'presigned'`) */
  uploadMode?: UploadMode;
  /** Custom HTTP headers attached to FormData upload requests */
  headers?: Record<string, string>;
  /** Send credentials/cookies with XHR/fetch requests */
  withCredentials?: boolean;
  /** Default UI locale (`'en' | 'ar'`) */
  locale?: UploadLocale;
  /** Global translation overrides */
  translations?: Partial<UploadTranslations>;
  /** Custom image component renderer (e.g. for custom CDN or framework `<Image />`) */
  renderImage?: CustomImageRenderer;
  /** Prefix used for sessionStorage metadata cache keys (defaults to `'iuk'`) */
  storageKeyPrefix?: string;
  /** Require alt text before saving in modal mode (defaults to `true`) */
  requireAltText?: boolean;
  /** Globally strip default `iuk-*` classes across all Single/Multi upload components */
  unstyled?: boolean;
  /** Global default slot `classNames` applied to all `<SingleImageUpload />` instances */
  singleClassNames?: SingleUploadClassNames;
  /** Global default slot `styles` applied to all `<SingleImageUpload />` instances */
  singleStyles?: SingleUploadStyles;
  /** Global default slot `classNames` applied to all `<MultiImageUpload />` instances */
  multiClassNames?: MultiUploadClassNames;
  /** Global default slot `styles` applied to all `<MultiImageUpload />` instances */
  multiStyles?: MultiUploadStyles;
}

export function ImageUploadProvider({
  children,
  endpoint = '/api/upload',
  deleteEndpoint,
  uploader,
  customDeleter,
  uploadMode,
  headers,
  withCredentials,
  locale,
  translations,
  renderImage,
  storageKeyPrefix = 'iuk',
  requireAltText = true,
  unstyled = false,
  singleClassNames,
  singleStyles,
  multiClassNames,
  multiStyles,
}: ImageUploadProviderProps) {
  const value = useMemo<ImageUploadContextValue>(
    () => ({
      endpoint,
      deleteEndpoint,
      uploader,
      customDeleter,
      uploadMode,
      headers,
      withCredentials,
      locale,
      translations,
      renderImage,
      storageKeyPrefix,
      requireAltText,
      unstyled,
      singleClassNames,
      singleStyles,
      multiClassNames,
      multiStyles,
    }),
    [
      endpoint,
      deleteEndpoint,
      uploader,
      customDeleter,
      uploadMode,
      headers,
      withCredentials,
      locale,
      translations,
      renderImage,
      storageKeyPrefix,
      requireAltText,
      unstyled,
      singleClassNames,
      singleStyles,
      multiClassNames,
      multiStyles,
    ],
  );

  return (
    <ImageUploadContext.Provider value={value}>
      {children}
    </ImageUploadContext.Provider>
  );
}

export function useImageUploadContext(): ImageUploadContextValue {
  return useContext(ImageUploadContext);
}
