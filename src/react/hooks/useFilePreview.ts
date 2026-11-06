import { useCallback, useEffect, useRef } from 'react';

export interface UseFilePreviewOptions {
  errorLabel?: string;
}

export function useFilePreview(options: UseFilePreviewOptions = {}) {
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const errorLabel = options.errorLabel || 'Failed to read file';

  const revokePreview = useCallback((url?: string | null) => {
    if (!url || !url.startsWith('blob:')) return;
    objectUrlsRef.current.delete(url);
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revocation errors
      }
    }
  }, []);

  const revokeAllPreviews = useCallback(() => {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of objectUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revocation errors
        }
      }
    }
    objectUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      revokeAllPreviews();
    };
  }, [revokeAllPreviews]);

  const createPreview = useCallback(
    (file: File): Promise<string> => {
      if (
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function'
      ) {
        try {
          const objectUrl = URL.createObjectURL(file);
          objectUrlsRef.current.add(objectUrl);
          return Promise.resolve(objectUrl);
        } catch {
          // Fall through to FileReader
        }
      }

      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error(errorLabel));
          }
        };
        reader.onerror = () => {
          reject(new Error(errorLabel));
        };
        reader.readAsDataURL(file);
      });
    },
    [errorLabel],
  );

  return { createPreview, revokePreview, revokeAllPreviews };
}
