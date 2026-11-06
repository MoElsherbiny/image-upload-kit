import { type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useRef } from 'react';

export type PasteTargetMode = 'dropzone' | 'document';

export interface UseClipboardPasteOptions {
  /** Enable clipboard image paste handling (defaults to `true`) */
  enabled?: boolean;
  /** Listen on the focused dropzone (`'dropzone'`) or globally on `document` (`'document'`). Defaults to `'dropzone'`. */
  pasteTarget?: PasteTargetMode;
  /** Disable paste handling when the uploader is disabled */
  disabled?: boolean;
  /** Allow pasting multiple images at once (defaults to `false` for single upload, `true` for multi upload) */
  multiple?: boolean;
  /** Callback invoked when one or more image files are pasted */
  onPasteFiles: (files: FileList) => void;
}

function isEditableTextTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || target.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type?.toLowerCase();
    return type !== 'file' && type !== 'button' && type !== 'checkbox' && type !== 'radio';
  }
  return false;
}

export function extractClipboardImageFiles(
  clipboardData: DataTransfer | null | undefined,
  multiple: boolean,
): File[] {
  if (!clipboardData) return [];

  const extracted: File[] = [];
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (file && file.type.startsWith('image/')) {
        extracted.push(file);
      }
    }
  }

  if (extracted.length === 0 && clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item && item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) extracted.push(file);
      }
    }
  }

  if (extracted.length === 0) return [];
  return multiple ? extracted : [extracted[0]];
}

export function toFileListLike(files: File[]): FileList {
  if (typeof DataTransfer !== 'undefined') {
    try {
      const dt = new DataTransfer();
      for (const file of files) dt.items.add(file);
      if (dt.files.length === files.length) return dt.files;
    } catch {
      // Fallback for test environments without full DataTransfer item mutation
    }
  }
  const arrayWithItem = Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  });
  return arrayWithItem as unknown as FileList;
}

export function useClipboardPaste({
  enabled = true,
  pasteTarget = 'dropzone',
  disabled = false,
  multiple = false,
  onPasteFiles,
}: UseClipboardPasteOptions) {
  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;
  const handledNativeEventsRef = useRef<WeakSet<Event>>(new WeakSet());

  const processPaste = useCallback(
    (
      clipboardData: DataTransfer | null | undefined,
      target: EventTarget | null,
      nativeEvent: Event,
      preventDefault: () => void,
    ) => {
      if (!enabled || disabled) return;
      if (handledNativeEventsRef.current.has(nativeEvent)) return;
      if (isEditableTextTarget(target)) return;

      const files = extractClipboardImageFiles(clipboardData, multiple);
      if (files.length === 0) return;

      handledNativeEventsRef.current.add(nativeEvent);
      preventDefault();
      onPasteFilesRef.current(toFileListLike(files));
    },
    [enabled, disabled, multiple],
  );

  const onPaste = useCallback(
    (event: ReactClipboardEvent<HTMLElement>) => {
      processPaste(
        event.clipboardData,
        event.target,
        event.nativeEvent,
        () => event.preventDefault(),
      );
    },
    [processPaste],
  );

  useEffect(() => {
    if (!enabled || disabled || pasteTarget !== 'document' || typeof document === 'undefined') {
      return;
    }
    const handleDocumentPaste = (event: ClipboardEvent) => {
      processPaste(
        event.clipboardData,
        event.target,
        event,
        () => event.preventDefault(),
      );
    };
    document.addEventListener('paste', handleDocumentPaste);
    return () => document.removeEventListener('paste', handleDocumentPaste);
  }, [enabled, disabled, pasteTarget, processPaste]);

  return { onPaste };
}
