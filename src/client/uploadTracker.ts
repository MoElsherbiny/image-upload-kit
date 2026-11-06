import type { UploadableAsset } from './types';

export interface ActiveUploadEntry<
  TAsset extends UploadableAsset = File,
> {
  id: string;
  file: TAsset;
  progress: number;
  message: string;
  controller: AbortController;
  interval: ReturnType<typeof setInterval> | null;
}

export interface UploadTracker<
  TAsset extends UploadableAsset = File,
> {
  entries: Map<string, ActiveUploadEntry<TAsset>>;
  createEntry: (
    file: TAsset,
    initialMessage: string,
    customId?: string,
    externalSignal?: AbortSignal,
  ) => ActiveUploadEntry<TAsset>;
  removeEntry: (id: string) => void;
  abortByIdOrFile: (idOrFile: string | TAsset) => boolean;
  abortAll: () => void;
}

let uploadCounter = 0;

export function createUploadTracker<
  TAsset extends UploadableAsset = File,
>(): UploadTracker<TAsset> {
  const entries = new Map<string, ActiveUploadEntry<TAsset>>();

  const clearEntryInterval = (entry: ActiveUploadEntry<TAsset>) => {
    if (entry.interval) {
      clearInterval(entry.interval);
      entry.interval = null;
    }
  };

  const createEntry = (
    file: TAsset,
    initialMessage: string,
    customId?: string,
    externalSignal?: AbortSignal,
  ): ActiveUploadEntry<TAsset> => {
    uploadCounter += 1;
    const id = customId || `upload-${Date.now()}-${uploadCounter}`;
    const controller = new AbortController();

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', () => controller.abort(), {
          once: true,
        });
      }
    }

    const existing = entries.get(id);
    if (existing) {
      clearEntryInterval(existing);
      existing.controller.abort();
      entries.delete(id);
    }

    const entry: ActiveUploadEntry<TAsset> = {
      id,
      file,
      progress: 0,
      message: initialMessage,
      controller,
      interval: null,
    };
    entries.set(id, entry);
    return entry;
  };

  const removeEntry = (id: string) => {
    const entry = entries.get(id);
    if (entry) {
      clearEntryInterval(entry);
      entries.delete(id);
    }
  };

  const abortByIdOrFile = (idOrFile: string | TAsset): boolean => {
    let aborted = false;
    for (const [key, entry] of entries.entries()) {
      if (
        (typeof idOrFile === 'string' && key === idOrFile) ||
        entry.file === idOrFile
      ) {
        clearEntryInterval(entry);
        entry.controller.abort();
        entries.delete(key);
        aborted = true;
      }
    }
    return aborted;
  };

  const abortAll = () => {
    for (const entry of entries.values()) {
      clearEntryInterval(entry);
      entry.controller.abort();
    }
    entries.clear();
  };

  return {
    entries,
    createEntry,
    removeEntry,
    abortByIdOrFile,
    abortAll,
  };
}
