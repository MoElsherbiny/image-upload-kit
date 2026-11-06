import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { UploadLocale, UploadPresetName } from '../types';
import type { NativeUploadTheme } from './theme';
import type {
  NativeCustomDeleterFn,
  NativeCustomUploaderFn,
  NativeImagePickerAdapter,
} from './types';

export interface NativeImageUploadConfig {
  endpoint: string;
  deleteEndpoint?: string;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  defaultPreset?: UploadPresetName;
  locale: UploadLocale;
  picker?: NativeImagePickerAdapter;
  theme?: Partial<NativeUploadTheme>;
  customUploader?: NativeCustomUploaderFn;
  customDeleter?: NativeCustomDeleterFn;
}

const DEFAULT_CONFIG: NativeImageUploadConfig = {
  endpoint: '/api/upload',
  locale: 'en',
};

const NativeImageUploadContext =
  createContext<NativeImageUploadConfig>(DEFAULT_CONFIG);

export interface NativeImageUploadProviderProps {
  children: ReactNode;
  endpoint?: string;
  deleteEndpoint?: string;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  defaultPreset?: UploadPresetName;
  locale?: UploadLocale;
  picker?: NativeImagePickerAdapter;
  theme?: Partial<NativeUploadTheme>;
  customUploader?: NativeCustomUploaderFn;
  customDeleter?: NativeCustomDeleterFn;
}

export function NativeImageUploadProvider({
  children,
  endpoint = '/api/upload',
  deleteEndpoint,
  headers,
  withCredentials,
  defaultPreset,
  locale = 'en',
  picker,
  theme,
  customUploader,
  customDeleter,
}: NativeImageUploadProviderProps) {
  const value = useMemo<NativeImageUploadConfig>(
    () => ({
      endpoint,
      deleteEndpoint,
      headers,
      withCredentials,
      defaultPreset,
      locale,
      picker,
      theme,
      customUploader,
      customDeleter,
    }),
    [
      endpoint,
      deleteEndpoint,
      headers,
      withCredentials,
      defaultPreset,
      locale,
      picker,
      theme,
      customUploader,
      customDeleter,
    ],
  );

  return (
    <NativeImageUploadContext.Provider value={value}>
      {children}
    </NativeImageUploadContext.Provider>
  );
}

export function useNativeImageUploadConfig(): NativeImageUploadConfig {
  return useContext(NativeImageUploadContext);
}

export const useNativeImageUploadContext = useNativeImageUploadConfig;
