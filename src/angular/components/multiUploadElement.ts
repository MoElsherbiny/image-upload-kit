import { attachPointerReorder } from '../../core/pointerReorder';
import { resolveTranslations } from '../../i18n';
import { aspectRatioToCss } from '../../types';
import {
  type AngularMultiUploadController,
  createMultiUpload,
} from '../controllers/multiUpload';
import type { AngularMultiUploadOptions } from '../types';
import {
  bindDragDropZone,
  createHiddenInput,
  HIDDEN_INPUT_CSS,
  makeBtn,
  slotEl,
} from './domHelpers';

export interface MountedMultiImageUpload {
  element: HTMLDivElement;
  inputElement: HTMLInputElement;
  controller: AngularMultiUploadController;
  destroy: () => void;
}

export function mountMultiImageUpload(
  host: HTMLElement,
  options: AngularMultiUploadOptions = {},
): MountedMultiImageUpload {
  const controller = createMultiUpload(options);
  const locale = options.locale ?? controller.locale;
  const ui = resolveTranslations(locale);
  const unstyled = Boolean(options.unstyled);
  const c = (name: string) => (unstyled ? undefined : name);
  const cssAspect = aspectRatioToCss(options.aspectRatio);

  const root = slotEl('div', 'multi-root', c('iuk-multi'));
  if (locale === 'ar') root.dir = 'rtl';

  const liveEl = document.createElement('div');
  liveEl.setAttribute('role', 'status');
  liveEl.setAttribute('aria-live', 'polite');
  liveEl.setAttribute('aria-atomic', 'true');
  liveEl.setAttribute('style', HIDDEN_INPUT_CSS);

  const input = createHiddenInput(
    options.accept,
    true,
    (files) => void controller.addFiles(files),
  );
  input.setAttribute('aria-label', options.label ?? ui.selectFilesAria);

  const bodyContainer = document.createElement('div');
  let detachPointerReorder: (() => void) | null = null;

  const syncDom = () => {
    detachPointerReorder?.();
    detachPointerReorder = null;

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
      const btn = makeBtn(
        'select-files-btn',
        ui.selectFilesAria,
        () => input.click(),
        isDisabled,
        c('iuk-btn iuk-btn--primary'),
      );
      btn.textContent = ui.selectFiles;
      empty.appendChild(btn);
      bodyContainer.appendChild(empty);
      return;
    }

    const grid = slotEl('div', 'grid', c('iuk-multi__grid'));
    list.forEach((item, index) => {
      const tile = slotEl('div', 'tile', c('iuk-tile'));
      tile.setAttribute('data-index', String(index));
      tile.setAttribute(
        'data-state',
        item.error ? 'error' : item.isUploading ? 'uploading' : 'ready',
      );
      if (cssAspect) tile.style.aspectRatio = cssAspect;

      if (controller.reorderable && !isDisabled && list.length > 1) {
        tile.tabIndex = 0;
        tile.addEventListener('keydown', (e: KeyboardEvent) => {
          if (controller.disabled() || !e.altKey) return;
          if (e.key === 'ArrowLeft' && index > 0) {
            e.preventDefault();
            controller.move(index, index - 1);
          } else if (e.key === 'ArrowRight' && index < list.length - 1) {
            e.preventDefault();
            controller.move(index, index + 1);
          }
        });
      }

      const media = slotEl('div', 'tile-media', c('iuk-tile__media'));
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.altText || ui.previewAlt;
      media.appendChild(img);

      if (index === 0 && controller.showCoverBadge) {
        media.appendChild(
          slotEl(
            'span',
            'cover-badge',
            c('iuk-tile__badge iuk-tile__badge--cover'),
            controller.coverBadgeLabel,
          ),
        );
      }
      if (controller.reorderable && !isDisabled && list.length > 1) {
        media.appendChild(
          makeBtn('tile-drag-handle', ui.dragHandle, () => {}),
        );
        media.appendChild(
          makeBtn(
            'tile-move-earlier',
            ui.moveEarlier,
            () => controller.move(index, index - 1),
            index === 0,
          ),
        );
        media.appendChild(
          makeBtn(
            'tile-move-later',
            ui.moveLater,
            () => controller.move(index, index + 1),
            index === list.length - 1,
          ),
        );
        if (index > 0) {
          media.appendChild(
            makeBtn(
              'tile-set-cover',
              ui.setAsCover,
              () => controller.setCover(index),
            ),
          );
        }
      }
      if (!isDisabled) {
        if (item.isUploading) {
          media.appendChild(
            makeBtn('tile-cancel', ui.cancelUpload, () => controller.cancelItem(item.id)),
          );
        } else if (item.error && item.file) {
          media.appendChild(
            makeBtn('tile-retry', ui.retryUpload, () => void controller.retryItem(item.id)),
          );
        }
        media.appendChild(
          makeBtn(
            'tile-remove-btn',
            ui.removeImageAria,
            () => void controller.removeItem(item.id),
          ),
        );
      }
      tile.appendChild(media);
      grid.appendChild(tile);
    });

    if (controller.reorderable) {
      detachPointerReorder = attachPointerReorder(grid, {
        disabled: () => controller.disabled(),
        onMove: (from, to) => controller.move(from, to),
      });
    }
    bodyContainer.appendChild(grid);
    if (controller.canAddMore()) {
      const addMoreBtn = makeBtn(
        'add-more-btn',
        ui.selectMoreFilesAria,
        () => input.click(),
        isDisabled,
        c('iuk-btn iuk-btn--secondary'),
      );
      addMoreBtn.textContent = ui.addMore;
      bodyContainer.appendChild(addMoreBtn);
    }
  };

  bindDragDropZone(root, {
    isDisabled: () => controller.disabled() || !controller.canAddMore(),
    setDragging: (d) => controller.setDragging(d),
    onFiles: (files) => void controller.addFiles(files),
  });

  root.append(liveEl, input, bodyContainer);
  host.appendChild(root);
  syncDom();

  const unsubs = [
    controller.items.subscribe(syncDom),
    controller.state.subscribe(syncDom),
    controller.disabled.subscribe(syncDom),
    controller.liveAnnouncement.subscribe(syncDom),
  ];

  return {
    element: root,
    inputElement: input,
    controller,
    destroy: () => {
      detachPointerReorder?.();
      detachPointerReorder = null;
      for (const u of unsubs) u();
      controller.destroy();
      root.remove();
    },
  };
}

export class MultiImageUploadComponent {
  private mounted: MountedMultiImageUpload | null = null;
  constructor(host?: HTMLElement, options?: AngularMultiUploadOptions) {
    if (host) this.mounted = mountMultiImageUpload(host, options);
  }
  mount(
    host: HTMLElement,
    options?: AngularMultiUploadOptions,
  ): MountedMultiImageUpload {
    this.destroy();
    this.mounted = mountMultiImageUpload(host, options);
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
