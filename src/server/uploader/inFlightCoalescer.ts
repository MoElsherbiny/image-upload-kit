import {
  hasStorageErrorMetadata,
  normalizeStorageError,
} from '../../storage/errorNormalizer';
import type { StorageAdapter } from '../../storage/types';
import type { UploadedImageData } from '../../types';
import { isUploadKitError, UploadKitError } from '../../types/errors';
import { SemaphoreQueueFullError } from '../semaphore';
import type { UploaderErrorAction, UploaderErrorHook } from './types';
import { deleteMirroredFiles } from './uploadRetry';
import { deleteStoredVariants } from './variantGenerator';

export function createAbortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error && signal.reason.name === 'AbortError') {
    return signal.reason;
  }
  const message =
    signal?.reason instanceof Error
      ? signal.reason.message
      : typeof signal?.reason === 'string' && signal.reason
        ? signal.reason
        : 'Upload cancelled';
  const err = new Error(message, { cause: signal?.reason });
  err.name = 'AbortError';
  return err;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

export function toUploadCancelledError(reason?: unknown): UploadKitError {
  if (isUploadKitError(reason) && reason.code === 'UPLOAD_CANCELLED') {
    return reason;
  }
  const message =
    reason instanceof Error && reason.message
      ? reason.message
      : typeof reason === 'string' && reason
        ? reason
        : 'Upload cancelled';
  return new UploadKitError(message, {
    code: 'UPLOAD_CANCELLED',
    status: 499,
    retryable: false,
    ...(reason !== undefined ? { cause: reason } : {}),
  });
}

export function safeReportUploaderError(
  onError: UploaderErrorHook | undefined,
  error: unknown,
  action: UploaderErrorAction,
): void {
  if (!onError) return;
  try {
    onError(error, { action });
  } catch {
    // Ignore secondary callback failures
  }
}

export async function rollbackIfUploadAborted(params: {
  signal?: AbortSignal;
  storage: StorageAdapter;
  bucket: string;
  mainPath: string;
  variantPaths: string[];
  mirrorDirs: string[];
  onError?: UploaderErrorHook;
}): Promise<void> {
  const { signal, storage, bucket, mainPath, variantPaths, mirrorDirs, onError } = params;
  if (!signal?.aborted) return;
  await storage.delete(bucket, mainPath).catch((e: unknown) => {
    safeReportUploaderError(onError, e, 'cleanup');
  });
  await deleteMirroredFiles(mirrorDirs, mainPath, onError);
  if (variantPaths.length > 0) {
    await deleteStoredVariants({
      storage, bucket, basePath: mainPath, mirrorDirs,
      knownVariantPaths: variantPaths, onError,
    });
  }
  throwIfAborted(signal);
}

export function mapUploaderError(
  error: unknown,
  action: 'upload' | 'deletion',
): never {
  if (isUploadKitError(error)) throw error;
  if (action === 'upload' && error instanceof SemaphoreQueueFullError) throw error;
  if (action === 'upload' && error instanceof Error && error.name === 'AbortError') {
    throw toUploadCancelledError(error);
  }
  if (hasStorageErrorMetadata(error)) {
    throw normalizeStorageError(error, {
      operation: action === 'deletion' ? 'delete' : 'upload',
    });
  }
  throw new Error(
    `Image ${action} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    { cause: error },
  );
}

interface InFlightEntry {
  controller: AbortController;
  promise: Promise<UploadedImageData>;
  activeCallers: number;
  settled: boolean;
}

export interface InFlightCoalescer {
  runOrJoin(
    key: string,
    callerSignal: AbortSignal | undefined,
    altText: string | undefined,
    execute: (sharedSignal: AbortSignal) => Promise<UploadedImageData>,
  ): Promise<UploadedImageData>;
}

/**
 * Coalesces identical concurrent uploads while isolating per-caller `AbortSignal`s.
 * The shared execution's internal `AbortController` only aborts when *every*
 * attached caller has aborted; an individual caller aborting rejects only that
 * caller with `UPLOAD_CANCELLED` while remaining callers continue unaffected.
 */
export function createInFlightCoalescer(maxEntries = 1000): InFlightCoalescer {
  const entries = new Map<string, InFlightEntry>();

  const formatForCaller = (
    res: UploadedImageData,
    altText: string | undefined,
    isFollower: boolean,
  ): UploadedImageData =>
    isFollower
      ? { ...res, altText: altText ?? res.altText, deduplicated: true }
      : { ...res, altText: altText ?? res.altText };

  const waitForEntry = (
    key: string,
    entry: InFlightEntry,
    callerSignal: AbortSignal | undefined,
    altText: string | undefined,
    isFollower: boolean,
  ): Promise<UploadedImageData> => {
    if (!callerSignal) {
      return entry.promise.then((res) => formatForCaller(res, altText, isFollower));
    }
    if (callerSignal.aborted) {
      entry.activeCallers = Math.max(0, entry.activeCallers - 1);
      if (entry.activeCallers === 0 && !entry.settled) {
        if (entries.get(key) === entry) entries.delete(key);
        entry.controller.abort(callerSignal.reason);
        return entry.promise.then(
          () => Promise.reject(toUploadCancelledError(callerSignal.reason)),
          () => Promise.reject(toUploadCancelledError(callerSignal.reason)),
        );
      }
      return Promise.reject(toUploadCancelledError(callerSignal.reason));
    }

    return new Promise<UploadedImageData>((resolve, reject) => {
      let callerAborted = false;

      const onAbort = () => {
        if (entry.settled || callerAborted) return;
        callerAborted = true;
        entry.activeCallers = Math.max(0, entry.activeCallers - 1);
        if (entry.activeCallers === 0) {
          if (entries.get(key) === entry) entries.delete(key);
          entry.controller.abort(callerSignal.reason);
          entry.promise.then(
            () => reject(toUploadCancelledError(callerSignal.reason)),
            () => reject(toUploadCancelledError(callerSignal.reason)),
          );
          return;
        }
        reject(toUploadCancelledError(callerSignal.reason));
      };

      callerSignal.addEventListener('abort', onAbort, { once: true });

      entry.promise.then(
        (res) => {
          callerSignal.removeEventListener('abort', onAbort);
          if (callerAborted) return;
          resolve(formatForCaller(res, altText, isFollower));
        },
        (err) => {
          callerSignal.removeEventListener('abort', onAbort);
          if (callerAborted) return;
          reject(err);
        },
      );
    });
  };

  return {
    runOrJoin(key, callerSignal, altText, execute) {
      if (callerSignal?.aborted) {
        return Promise.reject(toUploadCancelledError(callerSignal.reason));
      }

      const existing = entries.get(key);
      if (existing && !existing.settled && !existing.controller.signal.aborted) {
        existing.activeCallers += 1;
        return waitForEntry(key, existing, callerSignal, altText, true);
      }

      if (entries.size >= maxEntries) {
        if (!callerSignal) return execute(new AbortController().signal);
        return execute(callerSignal);
      }

      const controller = new AbortController();
      const holder: { current?: InFlightEntry } = {};
      const promise = execute(controller.signal).then(
        (res) => {
          if (holder.current) holder.current.settled = true;
          if (holder.current && entries.get(key) === holder.current) entries.delete(key);
          return res;
        },
        (err: unknown) => {
          if (holder.current) holder.current.settled = true;
          if (holder.current && entries.get(key) === holder.current) entries.delete(key);
          throw err;
        },
      );
      void promise.catch(() => {});
      const entry: InFlightEntry = {
        controller,
        promise,
        activeCallers: 1,
        settled: false,
      };
      holder.current = entry;
      entries.set(key, entry);

      return waitForEntry(key, entry, callerSignal, altText, false);
    },
  };
}
