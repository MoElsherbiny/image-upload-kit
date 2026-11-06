import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createUploadTracker,
  deleteUploadedImage,
  getAssetSize,
  isHeicAsset,
  isUploadAbortError,
  type NativeUploadAsset,
  runTransformAsset,
  type TransformAssetFn,
  type UploadMode,
  uploadAsset as uploadClientAsset,
} from '../../client';
import {
  type CropStrategy,
  type ExplicitOutputFormat,
  type ImageAspectRatio,
  type ImageDimensions,
  STANDARD_PRESETS,
  type StandardPresetName,
  type UploadedImageData,
  type UploadPresetName,
} from '../../types';
import { useNativeImageUploadConfig } from '../context';
import type { NativeCustomDeleterFn, NativeCustomUploaderFn } from '../types';

export interface NativeUploadCallOptions {
  id?: string;
  index?: number;
  preset?: UploadPresetName;
  folder?: string;
  bucket?: string;
  altText?: string;
  customFilename?: string;
  outputFormat?: ExplicitOutputFormat;
  quality?: number;
  maxDimensions?: ImageDimensions;
  aspectRatio?: ImageAspectRatio;
  crop?: CropStrategy;
  maxSizeMB?: number;
  metadata?: Record<string, string>;
  uploadMode?: UploadMode;
  transformAsset?: TransformAssetFn<NativeUploadAsset>;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export interface UseNativeUploadOptions {
  endpoint?: string;
  deleteEndpoint?: string;
  uploadMode?: UploadMode;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  defaultPreset?: UploadPresetName;
  maxSizeMB?: number;
  transformAsset?: TransformAssetFn<NativeUploadAsset>;
  customUploader?: NativeCustomUploaderFn;
  customDeleter?: NativeCustomDeleterFn;
}

export function useNativeUpload(options: UseNativeUploadOptions = {}) {
  const ctx = useNativeImageUploadConfig();
  const endpoint = options.endpoint ?? ctx.endpoint;
  const deleteEndpoint = options.deleteEndpoint ?? ctx.deleteEndpoint ?? endpoint;
  const uploadMode = options.uploadMode ?? ctx.uploadMode ?? 'direct';
  const headers = options.headers ?? ctx.headers;
  const withCredentials = options.withCredentials ?? ctx.withCredentials;
  const defaultPreset = options.defaultPreset ?? ctx.defaultPreset;
  const customUploader = options.customUploader ?? ctx.customUploader;
  const customDeleter = options.customDeleter ?? ctx.customDeleter;

  const trackerRef = useRef(createUploadTracker<NativeUploadAsset>());
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tracker = trackerRef.current;
    return () => {
      tracker.abortAll();
    };
  }, []);

  const syncUploadingState = useCallback(() => {
    const entries = Array.from(trackerRef.current.entries.values());
    setIsUploading(entries.length > 0);
    if (entries.length === 0) {
      return;
    }
    const avg = Math.round(
      entries.reduce((sum, item) => sum + item.progress, 0) / entries.length,
    );
    setProgress(avg);
  }, []);

  const uploadAsset = useCallback(
    async (
      asset: NativeUploadAsset,
      callOptions: NativeUploadCallOptions = {},
    ): Promise<UploadedImageData | null> => {
      const preset = callOptions.preset ?? defaultPreset;
      const transformFn = callOptions.transformAsset ?? options.transformAsset;

      const entry = trackerRef.current.createEntry(
        asset,
        'Uploading...',
        callOptions.id,
        callOptions.signal,
      );
      setError(null);
      setIsUploading(true);
      setProgress(0);

      const handleProgress = (pct: number) => {
        entry.progress = pct;
        callOptions.onProgress?.(pct);
        syncUploadingState();
      };

      try {
        if (isHeicAsset(asset) && !transformFn) {
          throw new Error(
            'HEIC/HEIF images are not supported directly. Enable compatible asset representation or provide transformAsset.',
          );
        }

        const transformed = await runTransformAsset(asset, transformFn, {
          signal: entry.controller.signal,
          preset,
          index: callOptions.index ?? 0,
        });

        if (isHeicAsset(transformed)) {
          throw new Error(
            'HEIC/HEIF images are not supported directly. Enable compatible asset representation or convert to JPEG/WebP.',
          );
        }

        const presetMaxMB =
          preset && preset in STANDARD_PRESETS
            ? STANDARD_PRESETS[preset as StandardPresetName]?.maxSizeMB
            : undefined;
        const maxSizeMB =
          callOptions.maxSizeMB ?? options.maxSizeMB ?? presetMaxMB;
        const byteSize = getAssetSize(transformed);
        if (
          typeof maxSizeMB === 'number' &&
          typeof byteSize === 'number' &&
          byteSize > maxSizeMB * 1024 * 1024
        ) {
          throw new Error(
            `Image size exceeds maximum allowed (${maxSizeMB}MB)`,
          );
        }

        const effectiveAspectRatio =
          callOptions.aspectRatio && callOptions.aspectRatio !== 'auto'
            ? callOptions.aspectRatio
            : undefined;

        const requestFields = {
          preset,
          folder: callOptions.folder,
          bucket: callOptions.bucket,
          altText: callOptions.altText,
          customFilename: callOptions.customFilename,
          outputFormat: callOptions.outputFormat,
          quality: callOptions.quality,
          maxDimensions: callOptions.maxDimensions,
          aspectRatio: effectiveAspectRatio,
          crop: callOptions.crop,
          metadata: callOptions.metadata,
        };

        const result = customUploader
          ? await customUploader(transformed, {
              ...requestFields,
              signal: entry.controller.signal,
              onProgress: handleProgress,
            })
          : await uploadClientAsset(transformed, requestFields, {
              endpoint,
              mode: callOptions.uploadMode ?? uploadMode,
              headers,
              withCredentials,
              signal: entry.controller.signal,
              onUploadProgress: handleProgress,
            });

        handleProgress(100);
        return result;
      } catch (err) {
        if (isUploadAbortError(err)) {
          return null;
        }
        const message =
          err instanceof Error ? err.message : 'Image upload failed';
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        trackerRef.current.removeEntry(entry.id);
        syncUploadingState();
      }
    },
    [
      customUploader,
      defaultPreset,
      endpoint,
      headers,
      options.maxSizeMB,
      options.transformAsset,
      syncUploadingState,
      uploadMode,
      withCredentials,
    ],
  );

  const cancelUpload = useCallback(
    (idOrAsset?: string | NativeUploadAsset): boolean => {
      if (idOrAsset === undefined) {
        trackerRef.current.abortAll();
        syncUploadingState();
        return true;
      }
      const aborted = trackerRef.current.abortByIdOrFile(idOrAsset);
      syncUploadingState();
      return aborted;
    },
    [syncUploadingState],
  );

  const deleteImage = useCallback(
    async (url: string): Promise<boolean> => {
      if (customDeleter) {
        return customDeleter(url);
      }
      try {
        await deleteUploadedImage(deleteEndpoint, url, {
          headers,
          withCredentials,
        });
        return true;
      } catch {
        return false;
      }
    },
    [customDeleter, deleteEndpoint, headers, withCredentials],
  );

  return {
    uploadAsset,
    cancelUpload,
    deleteImage,
    isUploading,
    progress,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
