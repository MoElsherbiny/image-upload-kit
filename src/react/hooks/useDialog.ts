import { type RefObject, useEffect, useId, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface UseDialogOptions {
  isOpen: boolean;
  onClose?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
}

export function useDialog({
  isOpen,
  onClose,
  initialFocusRef,
  lockScroll = true,
}: UseDialogOptions) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const prevOverflow = document.body.style.overflow;
    if (lockScroll) {
      document.body.style.overflow = 'hidden';
    }

    const focusInitial = () => {
      const container = dialogRef.current;
      if (!container) return;
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }
      if (
        document.activeElement &&
        container.contains(document.activeElement)
      ) {
        return;
      }
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        container.focus();
      }
    };

    focusInitial();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onCloseRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;

      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (lockScroll) {
        document.body.style.overflow = prevOverflow;
      }
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try {
          previouslyFocused.focus();
        } catch {
          // Ignore focus restore errors if node was detached
        }
      }
    };
  }, [isOpen, lockScroll, initialFocusRef]);

  return {
    dialogRef,
    titleId,
    descriptionId,
  };
}
