import { useCallback, useState } from 'react';
import type { NativeUploadAsset } from '../../client';
import type { UploadedImageData } from '../../types';
import { useNativeImageUploadConfig } from '../context';
import type {
  NativeImagePickerOptions,
  NativeSingleImageUploadProps,
} from '../types';
import { useNativeUpload } from './useNativeUpload';

export interface UseNativeSingleUploadReturn {
  image: UploadedImageData | null;
  previewUri: string | null;
  isUploading: boolean;
  progress: number;
  error: string | null;
  uploadAsset: (asset: NativeUploadAsset) => Promise<UploadedImageData | null>;
  pickFromLibrary: (
    options?: NativeImagePickerOptions,
  ) => Promise<UploadedImageData | null>;
  takePhoto: (
    options?: NativeImagePickerOptions,
  ) => Promise<UploadedImageData | null>;
  cancel: () => void;
  retry: () => Promise<UploadedImageData | null>;
  clear: () => Promise<void>;
}

export function useNativeSingleUpload(
  props: NativeSingleImageUploadProps = {},
): UseNativeSingleUploadReturn {
  const ctx = useNativeImageUploadConfig();
  const isControlled = props.value !== undefined;
  const [internalValue, setInternalValue] = useState<UploadedImageData | null>(
    props.defaultValue ?? null,
  );
  const currentImage = isControlled ? (props.value ?? null) : internalValue;

  const [optimisticUri, setOptimisticUri] = useState<string | null>(null);
  const [lastAsset, setLastAsset] = useState<NativeUploadAsset | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const picker = props.picker ?? ctx.picker;

  const {
    uploadAsset: rawUploadAsset,
    cancelUpload,
    deleteImage,
    isUploading,
    progress,
    error: uploadError,
    clearError,
  } = useNativeUpload({
    endpoint: props.endpoint,
    deleteEndpoint: props.deleteEndpoint,
    uploadMode: props.uploadMode,
    headers: props.headers,
    withCredentials: props.withCredentials,
    defaultPreset: props.preset,
    maxSizeMB: props.maxSizeMB,
    transformAsset: props.transformAsset,
    customUploader: props.customUploader,
    customDeleter: props.customDeleter,
  });

  const updateValue = useCallback(
    (next: UploadedImageData | null) => {
      if (!isControlled) {
        setInternalValue(next);
      }
      props.onChange?.(next);
    },
    [isControlled, props],
  );

  const uploadAsset = useCallback(
    async (asset: NativeUploadAsset): Promise<UploadedImageData | null> => {
      if (props.disabled) return null;
      setLastAsset(asset);
      setOptimisticUri(asset.uri);
      setLocalError(null);
      clearError();

      try {
        const uploaded = await rawUploadAsset(asset, {
          id: 'single-upload',
          index: 0,
          preset: props.preset,
          folder: props.folder,
          bucket: props.bucket,
          altText: props.altText,
          quality: props.quality,
          aspectRatio: props.aspectRatio,
          crop: props.crop,
          maxSizeMB: props.maxSizeMB,
          metadata: props.metadata,
          uploadMode: props.uploadMode,
          transformAsset: props.transformAsset,
        });

        if (!uploaded) {
          setOptimisticUri(null);
          return null;
        }

        setOptimisticUri(null);
        updateValue(uploaded);
        props.onUploadComplete?.(uploaded);
        return uploaded;
      } catch (err) {
        const normalized =
          err instanceof Error ? err : new Error('Image upload failed');
        setLocalError(normalized.message);
        props.onError?.(normalized);
        return null;
      }
    },
    [clearError, props, rawUploadAsset, updateValue],
  );

  const pickFromLibrary = useCallback(
    async (
      options?: NativeImagePickerOptions,
    ): Promise<UploadedImageData | null> => {
      if (props.disabled) return null;
      if (!picker) {
        const err = new Error(
          'No NativeImagePickerAdapter configured. Pass picker prop or configure NativeImageUploadProvider.',
        );
        setLocalError(err.message);
        props.onError?.(err);
        return null;
      }
      try {
        const assets = await picker.pickFromLibrary({
          multiple: false,
          maxFiles: 1,
          aspectRatio: props.aspectRatio,
          ...options,
        });
        const first = assets[0];
        if (!first) return null;
        return await uploadAsset(first);
      } catch (err) {
        const normalized =
          err instanceof Error ? err : new Error('Failed to pick image');
        setLocalError(normalized.message);
        props.onError?.(normalized);
        return null;
      }
    },
    [picker, props, uploadAsset],
  );

  const takePhoto = useCallback(
    async (
      options?: NativeImagePickerOptions,
    ): Promise<UploadedImageData | null> => {
      if (props.disabled) return null;
      if (!picker) {
        const err = new Error(
          'No NativeImagePickerAdapter configured. Pass picker prop or configure NativeImageUploadProvider.',
        );
        setLocalError(err.message);
        props.onError?.(err);
        return null;
      }
      try {
        const assets = await picker.takePhoto({
          multiple: false,
          maxFiles: 1,
          aspectRatio: props.aspectRatio,
          ...options,
        });
        const first = assets[0];
        if (!first) return null;
        return await uploadAsset(first);
      } catch (err) {
        const normalized =
          err instanceof Error ? err : new Error('Failed to capture photo');
        setLocalError(normalized.message);
        props.onError?.(normalized);
        return null;
      }
    },
    [picker, props, uploadAsset],
  );

  const cancel = useCallback(() => {
    cancelUpload('single-upload');
    setOptimisticUri(null);
  }, [cancelUpload]);

  const retry = useCallback(async (): Promise<UploadedImageData | null> => {
    if (!lastAsset) return null;
    return uploadAsset(lastAsset);
  }, [lastAsset, uploadAsset]);

  const clear = useCallback(async (): Promise<void> => {
    cancelUpload('single-upload');
    const existingUrl = currentImage?.url;
    setOptimisticUri(null);
    setLastAsset(null);
    setLocalError(null);
    clearError();
    updateValue(null);
    if (existingUrl && (props.deleteEndpoint || props.customDeleter)) {
      try {
        await deleteImage(existingUrl);
      } catch {
        // Ignore background delete errors after local clear
      }
    }
  }, [
    cancelUpload,
    clearError,
    currentImage?.url,
    deleteImage,
    props.customDeleter,
    props.deleteEndpoint,
    updateValue,
  ]);

  const error = localError ?? uploadError;
  const previewUri = optimisticUri ?? currentImage?.url ?? null;

  return {
    image: currentImage,
    previewUri,
    isUploading,
    progress,
    error,
    uploadAsset,
    pickFromLibrary,
    takePhoto,
    cancel,
    retry,
    clear,
  };
}
