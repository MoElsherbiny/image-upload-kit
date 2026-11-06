import { aspectRatioToCss } from '../../types';
import { type AngularMultiUploadController, createMultiUpload } from '../controllers/multiUpload';
import { type AngularSingleUploadController, createSingleUpload } from '../controllers/singleUpload';
import type { AngularMultiUploadOptions, AngularSingleUploadOptions } from '../types';

const HIDDEN_INPUT_CSS =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
const DEFAULT_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml';

function slotEl<K extends keyof HTMLElementTagNameMap>(
  tag: K, slot?: string, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (slot) el.setAttribute('data-slot', slot);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function makeBtn(
  slot: string, ariaLabel: string, onClick: () => void, disabled = false, className?: string,
): HTMLButtonElement {
  const btn = slotEl('button', slot, className);
  btn.type = 'button';
  btn.setAttribute('aria-label', ariaLabel);
  btn.disabled = disabled;
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

function createHiddenInput(
  accept: string | undefined, multiple: boolean, onFiles: (files: FileList) => void,
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

export interface MountedSingleImageUpload {
  element: HTMLDivElement; inputElement: HTMLInputElement;
  controller: AngularSingleUploadController; destroy: () => void;
}

export interface MountedMultiImageUpload {
  element: HTMLDivElement; inputElement: HTMLInputElement;
  controller: AngularMultiUploadController; destroy: () => void;
}

export function mountSingleImageUpload(
  host: HTMLElement,
  options: AngularSingleUploadOptions = {},
): MountedSingleImageUpload {
  const controller = createSingleUpload(options);
  const unstyled = Boolean(options.unstyled);
  const c = (name: string) => (unstyled ? undefined : name);

  const root = slotEl('div', 'single-root', c('iuk-single'));
  const input = createHiddenInput(options.accept, false, (files) => {
    if (files[0]) void controller.selectFile(files[0]);
  });
  input.setAttribute('aria-label', options.label ?? 'Upload image');

  const dropzone = slotEl('div', 'dropzone');
  const cssAspect = aspectRatioToCss(options.aspectRatio);
  if (cssAspect) dropzone.style.aspectRatio = cssAspect;

  const errorEl = slotEl('p', 'error-text', c('iuk-helper-text iuk-helper-text--error'));
  errorEl.setAttribute('role', 'alert');

  const syncDom = () => {
    const st = controller.state();
    const preview = controller.previewUrl();
    const err = controller.error();
    const isDisabled = controller.disabled();
    const uploading = controller.isUploading();

    root.setAttribute('data-state', st);
    input.disabled = isDisabled;
    dropzone.setAttribute('data-state', st);
    if (!unstyled) {
      dropzone.className = [
        'iuk-dropzone',
        preview ? 'iuk-dropzone--has-image' : '',
        isDisabled ? 'iuk-dropzone--disabled' : '',
        err ? 'iuk-dropzone--error' : '',
      ].filter(Boolean).join(' ');
    }

    dropzone.innerHTML = '';
    if (preview) {
      const wrap = slotEl('div', 'preview-wrap', c('iuk-single__preview-wrap'));
      const tile = slotEl('div', 'tile', c('iuk-tile'));
      tile.setAttribute('data-state', st);
      const media = slotEl('div', 'tile-media', c('iuk-tile__media'));
      const img = document.createElement('img');
      img.src = preview;
      img.alt = controller.altText() || 'Preview';
      media.appendChild(img);
      if (!isDisabled) {
        media.appendChild(
          uploading
            ? makeBtn('tile-cancel', 'Cancel upload', () => controller.cancel())
            : makeBtn('tile-remove-btn', 'Remove image', () => void controller.clear(), false, c('iuk-tile__action iuk-tile__action--remove')),
        );
      }
      tile.appendChild(media);
      wrap.appendChild(tile);
      dropzone.appendChild(wrap);
    } else {
      const prompt = slotEl('div', 'dropzone-prompt', c('iuk-dropzone__prompt'));
      const msg = uploading ? controller.uploadStatus() || 'Uploading...' : 'Drag & drop or click to upload';
      prompt.appendChild(slotEl('p', 'dropzone-text', c('iuk-dropzone__text'), msg));
      dropzone.appendChild(prompt);
    }

    if (err) {
      errorEl.textContent = err;
      if (!errorEl.parentElement) root.appendChild(errorEl);
    } else {
      errorEl.remove();
    }
  };

  dropzone.addEventListener('click', () => {
    if (!controller.disabled() && !controller.previewUrl()) input.click();
  });

  root.append(input, dropzone);
  host.appendChild(root);
  syncDom();

  const unsubs = [
    controller.state.subscribe(syncDom), controller.previewUrl.subscribe(syncDom),
    controller.isUploading.subscribe(syncDom), controller.error.subscribe(syncDom),
    controller.disabled.subscribe(syncDom),
  ];

  return {
    element: root, inputElement: input, controller,
    destroy: () => { for (const u of unsubs) u(); controller.destroy(); root.remove(); },
  };
}

export function mountMultiImageUpload(
  host: HTMLElement,
  options: AngularMultiUploadOptions = {},
): MountedMultiImageUpload {
  const controller = createMultiUpload(options);
  const unstyled = Boolean(options.unstyled);
  const c = (name: string) => (unstyled ? undefined : name);
  const cssAspect = aspectRatioToCss(options.aspectRatio);

  const root = slotEl('div', 'multi-root', c('iuk-multi'));
  const liveEl = document.createElement('div');
  liveEl.setAttribute('role', 'status');
  liveEl.setAttribute('aria-live', 'polite');
  liveEl.setAttribute('aria-atomic', 'true');
  liveEl.setAttribute('style', HIDDEN_INPUT_CSS);

  const input = createHiddenInput(options.accept, true, (files) => void controller.addFiles(files));
  const bodyContainer = document.createElement('div');

  const syncDom = () => {
    const st = controller.state();
    const list = controller.items();
    const isDisabled = controller.disabled();
    root.setAttribute('data-state', st);
    input.disabled = isDisabled;
    liveEl.textContent = controller.liveAnnouncement();
    bodyContainer.innerHTML = '';

    if (list.length === 0) {
      const empty = slotEl('div', 'empty-dropzone', c('iuk-multi__empty'));
      empty.setAttribute('data-state', st);
      const btn = makeBtn('select-files-btn', 'Select files', () => input.click(), isDisabled, c('iuk-btn iuk-btn--primary'));
      btn.textContent = 'Select Files';
      empty.appendChild(btn);
      bodyContainer.appendChild(empty);
      return;
    }

    const grid = slotEl('div', 'grid', c('iuk-multi__grid'));
    list.forEach((item, index) => {
      const tile = slotEl('div', 'tile', c('iuk-tile'));
      tile.setAttribute('data-index', String(index));
      tile.setAttribute('data-state', item.error ? 'error' : item.isUploading ? 'uploading' : 'ready');
      if (cssAspect) tile.style.aspectRatio = cssAspect;

      const media = slotEl('div', 'tile-media', c('iuk-tile__media'));
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.altText ?? '';
      media.appendChild(img);

      if (index === 0 && controller.showCoverBadge) {
        media.appendChild(slotEl('span', 'cover-badge', c('iuk-tile__badge iuk-tile__badge--cover'), controller.coverBadgeLabel));
      }
      if (controller.reorderable && !isDisabled && list.length > 1) {
        media.appendChild(makeBtn('tile-move-earlier', 'Move image earlier', () => controller.move(index, index - 1), index === 0));
        media.appendChild(makeBtn('tile-move-later', 'Move image later', () => controller.move(index, index + 1), index === list.length - 1));
        if (index > 0) media.appendChild(makeBtn('tile-set-cover', 'Set as cover image', () => controller.setCover(index)));
      }
      if (!isDisabled) {
        media.appendChild(makeBtn('tile-remove-btn', 'Remove image', () => void controller.removeItem(item.id)));
      }
      tile.appendChild(media);
      grid.appendChild(tile);
    });
    bodyContainer.appendChild(grid);
  };

  root.append(liveEl, input, bodyContainer);
  host.appendChild(root);
  syncDom();

  const unsubs = [
    controller.items.subscribe(syncDom), controller.state.subscribe(syncDom),
    controller.disabled.subscribe(syncDom), controller.liveAnnouncement.subscribe(syncDom),
  ];

  return {
    element: root, inputElement: input, controller,
    destroy: () => { for (const u of unsubs) u(); controller.destroy(); root.remove(); },
  };
}

export class SingleImageUploadComponent {
  private mounted: MountedSingleImageUpload | null = null;
  constructor(host?: HTMLElement, options?: AngularSingleUploadOptions) {
    if (host) this.mounted = mountSingleImageUpload(host, options);
  }
  mount(host: HTMLElement, options?: AngularSingleUploadOptions): MountedSingleImageUpload {
    this.destroy();
    this.mounted = mountSingleImageUpload(host, options);
    return this.mounted;
  }
  ngOnDestroy(): void { this.destroy(); }
  destroy(): void { this.mounted?.destroy(); this.mounted = null; }
}

export class MultiImageUploadComponent {
  private mounted: MountedMultiImageUpload | null = null;
  constructor(host?: HTMLElement, options?: AngularMultiUploadOptions) {
    if (host) this.mounted = mountMultiImageUpload(host, options);
  }
  mount(host: HTMLElement, options?: AngularMultiUploadOptions): MountedMultiImageUpload {
    this.destroy();
    this.mounted = mountMultiImageUpload(host, options);
    return this.mounted;
  }
  ngOnDestroy(): void { this.destroy(); }
  destroy(): void { this.mounted?.destroy(); this.mounted = null; }
}
