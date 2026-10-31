import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExplicitOutputFormat,
  ImageDimensions,
  UploadedImageData,
  UploadLocale,
} from '../../types';
import {
  createSuccessMessage,
  getStatusMessage,
} from '../../utils/formatters';
import { useImageUploadContext } from '../context';
import { normalizeUploadLocale, resolveTranslations } from '../i18n';
import type { CustomUploaderFn } from '../types';
import { buildUploadFormData, uploadViaXhr } from './xhrUpload';

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
  customFilename?: string;
  endpoint?: string;
  uploader?: CustomUploaderFn;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  locale?: UploadLocale;
  onSuccess?: (data: UploadedImageData, file?: File) => void;
  onError?: (error: string, file?: File) => void;
  onProgress?: (progress: number, message: string, file?: File) => void;
}

export function useImageUpload({
  preset,
  folder,
  bucket,
  metadata,
  altText,
  outputFormat,
  quality,
  maxDimensions,
  customFilename: defaultCustomFilename,
  endpoint: propEndpoint,
  uploader: propUploader,
  headers: propHeaders,
  withCredentials: propWithCredentials,
  locale: propLocale,
  onSuccess,
  onError,
  onProgress,
}: UseImageUploadOptions = {}) {
  const ctx = useImageUploadContext();
  const uploadLocale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(uploadLocale, ctx.translations);

  const resolvedEndpoint = propEndpoint || ctx.endpoint || '/api/upload';
  const resolvedUploader = propUploader || ctx.uploader;
  const resolvedHeaders = propHeaders || ctx.headers;
  const resolvedCredentials = propWithCredentials ?? ctx.withCredentials;

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');

  const isMountedRef = useRef(true);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const activeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearProgressInterval = useCallback(() => {
    if (activeIntervalRef.current) {
      clearInterval(activeIntervalRef.current);
      activeIntervalRef.current = null;
    }
  }, []);

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current.clear();
  }, []);

  const safeSetTimeout = useCallback((fn: () => void, ms: number) => {
    const handle = setTimeout(() => {
      timeoutsRef.current.delete(handle);
      if (isMountedRef.current) {
        fn();
      }
    }, ms);
    timeoutsRef.current.add(handle);
    return handle;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearProgressInterval();
      clearAllTimeouts();
    };
  }, [clearProgressInterval, clearAllTimeouts]);

  const uploadImage = useCallback(
    async (
      file: File,
      customAltText?: string,
      overrideCustomFilename?: string,
    ): Promise<UploadedImageData | null> => {
      clearProgressInterval();
      clearAllTimeouts();

      const originalSize = file.size;
      setIsUploading(true);
      setProgress(0);
      setUploadMessage(ui.preparingUpload);
      onProgress?.(0, ui.preparingUpload, file);

      const reportProgress = (nextPct: number) => {
        if (!isMountedRef.current) return;
        setProgress((prev) => {
          const clamped = Math.max(prev, Math.min(94, nextPct));
          const msg = getStatusMessage(clamped, uploadLocale);
          setUploadMessage(msg);
          onProgress?.(clamped, msg, file);
          return clamped;
        });
      };

      try {
        activeIntervalRef.current = setInterval(() => {
          if (!isMountedRef.current) {
            clearProgressInterval();
            return;
          }
          setProgress((prev) => {
            const nextProgress = Math.min(prev + 6, 92);
            const msg = getStatusMessage(nextProgress, uploadLocale);
            setUploadMessage(msg);
            onProgress?.(nextProgress, msg, file);
            return nextProgress;
          });
        }, 300);

        const finalAlt = customAltText || altText || undefined;
        const finalCustomFilename =
          overrideCustomFilename || defaultCustomFilename || undefined;

        const requestFields = {
          preset,
          folder,
          bucket,
          altText: finalAlt,
          customFilename: finalCustomFilename,
          outputFormat,
          quality,
          maxDimensions,
          metadata,
        };

        const data = resolvedUploader
          ? await resolvedUploader(file, {
              ...requestFields,
              onUploadProgress: reportProgress,
            })
          : await uploadViaXhr(
              resolvedEndpoint,
              buildUploadFormData(file, requestFields),
              {
                headers: resolvedHeaders,
                withCredentials: resolvedCredentials,
                fallbackErrorLabel: ui.uploadFailed,
                onUploadProgress: reportProgress,
              },
            );

        clearProgressInterval();
        if (!isMountedRef.current) return data;

        setProgress(100);
        const successMsg = createSuccessMessage(
          originalSize,
          data.size,
          false,
          uploadLocale,
        );
        setUploadMessage(successMsg);
        onProgress?.(100, successMsg, file);

        safeSetTimeout(() => {
          setUploadMessage('');
        }, 5000);

        onSuccess?.(data, file);
        return data;
      } catch (err) {
        clearProgressInterval();
        if (!isMountedRef.current) return null;
        const errorMsg = err instanceof Error ? err.message : ui.uploadFailed;
        setUploadMessage('');
        onError?.(errorMsg, file);
        return null;
      } finally {
        clearProgressInterval();
        if (isMountedRef.current) {
          setIsUploading(false);
          safeSetTimeout(() => {
            setProgress(0);
          }, 1000);
        }
      }
    },
    [
      preset,
      folder,
      bucket,
      metadata,
      altText,
      outputFormat,
      quality,
      maxDimensions,
      defaultCustomFilename,
      resolvedEndpoint,
      resolvedUploader,
      resolvedHeaders,
      resolvedCredentials,
      uploadLocale,
      ui.preparingUpload,
      ui.uploadFailed,
      onSuccess,
      onError,
      onProgress,
      clearProgressInterval,
      clearAllTimeouts,
      safeSetTimeout,
    ],
  );

  const reset = useCallback(() => {
    clearProgressInterval();
    clearAllTimeouts();
    setIsUploading(false);
    setProgress(0);
    setUploadMessage('');
  }, [clearProgressInterval, clearAllTimeouts]);

  return {
    uploadImage,
    isUploading,
    progress,
    uploadMessage,
    reset,
  };
}
