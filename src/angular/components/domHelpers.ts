export const HIDDEN_INPUT_CSS =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';

export const DEFAULT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/avif,image/svg+xml';

export function slotEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  slot?: string,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (slot) el.setAttribute('data-slot', slot);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function makeBtn(
  slot: string,
  ariaLabel: string,
  onClick: () => void,
  disabled = false,
  className?: string,
): HTMLButtonElement {
  const btn = slotEl('button', slot, className);
  btn.type = 'button';
  btn.setAttribute('aria-label', ariaLabel);
  btn.disabled = disabled;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

export function createHiddenInput(
  accept: string | undefined,
  multiple: boolean,
  onFiles: (files: FileList) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = multiple;
  input.accept = accept ?? DEFAULT_ACCEPT;
  input.setAttribute('style', HIDDEN_INPUT_CSS);
  input.addEventListener('change', () => {
    if (input.files && input.files.length > 0) onFiles(input.files);
    input.value = '';
  });
  return input;
}

export function bindDragDropZone(
  element: HTMLElement,
  opts: {
    isDisabled: () => boolean;
    setDragging: (dragging: boolean) => void;
    onFiles: (files: FileList) => void;
  },
): void {
  element.addEventListener('dragenter', (e: DragEvent) => {
    e.preventDefault();
    if (!opts.isDisabled()) opts.setDragging(true);
  });
  element.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    if (!opts.isDisabled()) opts.setDragging(true);
  });
  element.addEventListener('dragleave', () => opts.setDragging(false));
  element.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    opts.setDragging(false);
    if (!opts.isDisabled() && e.dataTransfer?.files?.length) {
      opts.onFiles(e.dataTransfer.files);
    }
  });
}
