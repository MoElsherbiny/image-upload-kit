import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';

export interface UseDragAndDropOptions {
  disabled?: boolean;
  onDrop: (files: FileList) => void;
}

export function useDragAndDrop({ disabled, onDrop }: UseDragAndDropOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (disabled) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  }, [disabled]);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragDepthRef.current += 1;
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        onDrop(files);
      }
    },
    [disabled, onDrop],
  );

  return {
    isDragging,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    },
  };
}
