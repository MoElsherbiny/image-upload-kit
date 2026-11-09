import { resolveTranslations } from '../../i18n';
import { aspectRatioToCss } from '../../types';
import {
  type AngularSingleUploadController,
  createSingleUpload,
} from '../controllers/singleUpload';
import type { AngularSingleUploadOptions } from '../types';
import { bindDragDropZone, createHiddenInput, makeBtn, slotEl } from './domHelpers';

export interface MountedSingleImageUpload {
  element: HTMLDivElement;
  inputElement: HTMLInputElement;
  controller: AngularSingleUploadController;
  destroy: () => void;
}

export function mountSingleImageUpload(
  host: HTMLElement,
  options: AngularSingleUploadOptions = {},
): MountedSingleImageUpload {
  const controller = createSingleUpload(options);
  const locale = options.locale ?? controller.locale;
  const ui = resolveTranslations(locale);
  const unstyled = Boolean(options.unstyled);
  const c = (name: string) => (unstyled ? undefined : name);

  const root = slotEl('div', 'single-root', c('iuk-single'));
  if (locale === 'ar') root.dir = 'rtl';

  const input = createHiddenInput(options.accept, false, (files) => {
    if (files[0]) void controller.selectFile(files[0]);
  });
  input.setAttribute('aria-label', options.label ?? ui.uploadImageAria);

  const dropzone = slotEl('div', 'dropzone');
  const cssAspect = aspectRatioToCss(options.aspectRatio);
  if (cssAspect) dropzone.style.aspectRatio = cssAspect;

  const errorEl = slotEl(
    'p',
    'error-text',
    c('iuk-helper-text iuk-helper-text--error'),
  );
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
      ]
        .filter(Boolean)
        .join(' ');
    }

    dropzone.innerHTML = '';
    if (preview) {
      const wrap = slotEl('div', 'preview-wrap', c('iuk-single__preview-wrap'));
      const tile = slotEl('div', 'tile', c('iuk-tile'));
      tile.setAttribute('data-state', st);
      const media = slotEl('div', 'tile-media', c('iuk-tile__media'));
      const img = document.createElement('img');
      img.src = preview;
      img.alt = controller.altText() || ui.previewAlt;
      media.appendChild(img);
      if (!isDisabled) {
        media.appendChild(
          uploading
            ? makeBtn('tile-cancel', ui.cancelUpload, () => controller.cancel())
            : makeBtn(
                'tile-remove-btn',
                ui.removeImageAria,
                () => void controller.clear(),
                false,
                c('iuk-tile__action iuk-tile__action--remove'),
              ),
        );
      }
      tile.appendChild(media);
      wrap.appendChild(tile);
      dropzone.appendChild(wrap);
    } else {
      const prompt = slotEl('div', 'dropzone-prompt', c('iuk-dropzone__prompt'));
      const msg = uploading
        ? controller.uploadStatus() || ui.uploading
        : ui.dragDropOrClickToUpload;
      prompt.appendChild(
        slotEl('p', 'dropzone-text', c('iuk-dropzone__text'), msg),
      );
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
  bindDragDropZone(dropzone, {
    isDisabled: () => controller.disabled(),
    setDragging: (d) => controller.setDragging(d),
    onFiles: (files) => {
      if (files[0]) void controller.selectFile(files[0]);
    },
  });

  root.append(input, dropzone);
  host.appendChild(root);
  syncDom();

  const unsubs = [
    controller.state.subscribe(syncDom),
    controller.previewUrl.subscribe(syncDom),
    controller.isUploading.subscribe(syncDom),
    controller.error.subscribe(syncDom),
    controller.disabled.subscribe(syncDom),
  ];

  return {
    element: root,
    inputElement: input,
    controller,
    destroy: () => {
      for (const u of unsubs) u();
      controller.destroy();
      root.remove();
    },
  };
}

export class SingleImageUploadComponent {
  private mounted: MountedSingleImageUpload | null = null;
  constructor(host?: HTMLElement, options?: AngularSingleUploadOptions) {
    if (host) this.mounted = mountSingleImageUpload(host, options);
  }
  mount(
    host: HTMLElement,
    options?: AngularSingleUploadOptions,
  ): MountedSingleImageUpload {
    this.destroy();
    this.mounted = mountSingleImageUpload(host, options);
    return this.mounted;
  }
  ngOnDestroy(): void {
    this.destroy();
  }
  destroy(): void {
    this.mounted?.destroy();
    this.mounted = null;
  }
}
