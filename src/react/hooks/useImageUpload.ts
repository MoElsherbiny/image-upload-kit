import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isHeicAsset,
  isUploadAbortError,
  runTransformAsset,
  type TransformAssetFn,
  type UploadMode,
  uploadAsset,
} from '../../client';
import type {
  CropStrategy,
  ExplicitOutputFormat,
  ImageAspectRatio,
  ImageDimensions,
  UploadedImageData,
  UploadLocale,
} from '../../types';
import { createSuccessMessage, getStatusMessage } from '../../utils/formatters';
import { useImageUploadContext } from '../context';
import { normalizeUploadLocale, resolveTranslations } from '../i18n';
import type { CustomUploaderFn } from '../types';
import { createUploadTracker, type UploadTracker } from './uploadTracker';

export interface UploadCallOptions {
  uploadId?: string;
  signal?: AbortSignal;
  index?: number;
}

export interface UseImageUploadOptions {
  preset?: string;
  folder?: string;
  bucket?: string;
  metadata?: Record<string, string>;
  altText?: string;
  outputFormat?: ExplicitOutputFormat;
  /** 1–100. When omitted, the server picks the preset or format default. */
  quality?: number;
  maxDimensions?: ImageDimensions;
  aspectRatio?: ImageAspectRatio;
  crop?: CropStrategy;
  transformAsset?: TransformAssetFn<File>;
  customFilename?: string;
  endpoint?: string;
  uploader?: CustomUploaderFn;
  uploadMode?: UploadMode;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  locale?: UploadLocale;
  onSuccess?: (data: UploadedImageData, file?: File, uploadId?: string) => void;
  onError?: (error: string, file?: File, uploadId?: string) => void;
  onProgress?: (progress: number, message: string, file?: File, uploadId?: string) => void;
}

export function useImageUpload({
  preset, folder, bucket, metadata, altText, outputFormat, quality, maxDimensions,
  aspectRatio, crop, transformAsset,
  customFilename: defaultCustomFilename,
  endpoint: propEndpoint, uploader: propUploader, uploadMode: propUploadMode,
  headers: propHeaders, withCredentials: propWithCredentials, locale: propLocale,
  onSuccess, onError, onProgress,
}: UseImageUploadOptions = {}) {
  const ctx = useImageUploadContext();
  const uploadLocale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(uploadLocale, ctx.translations);

  const resolvedEndpoint = propEndpoint || ctx.endpoint || '/api/upload';
  const resolvedUploader = propUploader || ctx.uploader;
  const resolvedUploadMode = propUploadMode ?? ctx.uploadMode ?? 'direct';
  const resolvedHeaders = propHeaders || ctx.headers;
  const resolvedCredentials = propWithCredentials ?? ctx.withCredentials;

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');

  const isMountedRef = useRef(true);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const trackerRef = useRef<UploadTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = createUploadTracker();

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current.clear();
  }, []);

  const safeSetTimeout = useCallback((fn: () => void, ms: number) => {
    const handle = setTimeout(() => {
      timeoutsRef.current.delete(handle);
      if (isMountedRef.current) fn();
    }, ms);
    timeoutsRef.current.add(handle);
    return handle;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const tracker = trackerRef.current;
    return () => {
      isMountedRef.current = false;
      tracker?.abortAll();
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  const abortUpload = useCallback((idOrFile: string | File) => {
    const tracker = trackerRef.current!;
    const aborted = tracker.abortByIdOrFile(idOrFile);
    if (aborted && isMountedRef.current && tracker.entries.size === 0) {
      setIsUploading(false);
      setProgress(0);
      setUploadMessage('');
    }
    return aborted;
  }, []);

  const abortAll = useCallback(() => {
    trackerRef.current?.abortAll();
    clearAllTimeouts();
    if (isMountedRef.current) {
      setIsUploading(false);
      setProgress(0);
      setUploadMessage('');
    }
  }, [clearAllTimeouts]);

  const uploadImage = useCallback(
    async (
      file: File,
      customAltText?: string,
      overrideCustomFilename?: string,
      callOptions?: UploadCallOptions,
    ): Promise<UploadedImageData | null> => {
      const tracker = trackerRef.current!;
      const initialMsg = transformAsset ? ui.transformingFile : ui.preparingUpload;
      const entry = tracker.createEntry(
        file,
        initialMsg,
        callOptions?.uploadId,
        callOptions?.signal,
      );
      const { id: uploadId, controller } = entry;

      const originalSize = file.size;
      setIsUploading(true);
      setProgress(0);
      setUploadMessage(initialMsg);
      onProgress?.(0, initialMsg, file, uploadId);

      const updateEntryProgress = (nextPct: number, maxCap: number) => {
        if (!isMountedRef.current || controller.signal.aborted) return;
        const clamped = Math.max(entry.progress, Math.min(maxCap, nextPct));
        entry.progress = clamped;
        const msg = getStatusMessage(clamped, uploadLocale);
        entry.message = msg;
        setProgress(clamped);
        setUploadMessage(msg);
        onProgress?.(clamped, msg, file, uploadId);
      };

      const reportProgress = (nextPct: number) => updateEntryProgress(nextPct, 94);

      try {
        const effectiveFile = await runTransformAsset(file, transformAsset, {
          signal: controller.signal,
          preset,
          index: callOptions?.index ?? 0,
        });

        if (isHeicAsset(effectiveFile)) {
          throw new Error(ui.heicNotSupported);
        }

        entry.interval = setInterval(() => {
          if (!isMountedRef.current || controller.signal.aborted) {
            tracker.removeEntry(uploadId);
            return;
          }
          updateEntryProgress(entry.progress + 6, 92);
        }, 300);

        const finalAlt = customAltText !== undefined ? customAltText || undefined : altText || undefined;
        const finalCustomFilename = overrideCustomFilename || defaultCustomFilename || undefined;
        const resolvedAspect =
          aspectRatio !== undefined && aspectRatio !== 'auto' ? aspectRatio : undefined;
        const requestFields = {
          preset, folder, bucket, altText: finalAlt, customFilename: finalCustomFilename,
          outputFormat, quality, maxDimensions, aspectRatio: resolvedAspect, crop, metadata,
        };

        const data = resolvedUploader
          ? await resolvedUploader(effectiveFile, {
              ...requestFields,
              signal: controller.signal,
              onUploadProgress: reportProgress,
            })
          : await uploadAsset(effectiveFile, requestFields, {
              endpoint: resolvedEndpoint,
              mode: resolvedUploadMode,
              headers: resolvedHeaders,
              withCredentials: resolvedCredentials,
              signal: controller.signal,
              fallbackErrorLabel: ui.uploadFailed,
              networkErrorLabel: ui.networkError,
              invalidResponseLabel: ui.invalidUploadResponse,
              abortedErrorLabel: ui.uploadAborted,
              onUploadProgress: reportProgress,
            });

        tracker.removeEntry(uploadId);
        if (!isMountedRef.current || controller.signal.aborted) return null;

        entry.progress = 100;
        setProgress(100);
        const successMsg = createSuccessMessage(originalSize, data.size, false, uploadLocale);
        setUploadMessage(successMsg);
        onProgress?.(100, successMsg, file, uploadId);

        safeSetTimeout(() => {
          if (tracker.entries.size === 0) setUploadMessage('');
        }, 5000);

        onSuccess?.(data, file, uploadId);
        return data;
      } catch (err) {
        tracker.removeEntry(uploadId);
        if (!isMountedRef.current || controller.signal.aborted || isUploadAbortError(err)) {
          return null;
        }
        const errorMsg = err instanceof Error ? err.message : ui.uploadFailed;
        setUploadMessage('');
        onError?.(errorMsg, file, uploadId);
        return null;
      } finally {
        tracker.removeEntry(uploadId);
        if (isMountedRef.current && tracker.entries.size === 0) {
          setIsUploading(false);
          safeSetTimeout(() => {
            if (tracker.entries.size === 0) setProgress(0);
          }, 1000);
        }
      }
    },
    [
      preset, folder, bucket, metadata, altText, outputFormat, quality, maxDimensions,
      aspectRatio, crop, transformAsset, defaultCustomFilename, resolvedEndpoint,
      resolvedUploader, resolvedUploadMode, resolvedHeaders, resolvedCredentials, uploadLocale,
      ui.transformingFile, ui.preparingUpload, ui.heicNotSupported, ui.uploadFailed,
      ui.networkError, ui.invalidUploadResponse, ui.uploadAborted,
      onSuccess, onError, onProgress, safeSetTimeout,
    ],
  );

  const reset = useCallback(() => {
    abortAll();
  }, [abortAll]);

  return { uploadImage, abortUpload, abortAll, isUploading, progress, uploadMessage, reset };
}
