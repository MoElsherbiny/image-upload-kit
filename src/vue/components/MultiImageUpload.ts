import {
  defineComponent, h, onBeforeUnmount, onMounted, type PropType, ref, type VNodeChild, watch,
} from 'vue';
import { attachPointerReorder } from '../../core/pointerReorder';
import { resolveTranslations } from '../../i18n';
import {
  aspectRatioToCss, type CropStrategy, type ExplicitOutputFormat, type ImageAspectRatio,
  type ImageDimensions, type QualityLevel, type UploadedImageData, type UploadLocale, type UploadPresetName,
} from '../../types';
import { useImageUploadConfig } from '../config';
import { useMultiUpload } from '../composables/useMultiUpload';
import type {
  CustomDeleterFn, CustomUploaderFn, TransformAssetFn, UploadMode, VueMultiUploadOptions,
} from '../types';
import { DEFAULT_ACCEPT, HIDDEN_INPUT_STYLE } from './SingleImageUpload';

export const MultiImageUpload = defineComponent({
  name: 'IukMultiImageUpload',
  props: {
    modelValue: { type: Array as PropType<UploadedImageData[]>, default: undefined },
    value: { type: Array as PropType<UploadedImageData[]>, default: undefined },
    preset: { type: String as PropType<UploadPresetName>, default: undefined },
    folder: { type: String, default: undefined },
    bucket: { type: String, default: undefined },
    metadata: { type: Object as PropType<Record<string, string>>, default: undefined },
    endpoint: { type: String, default: undefined },
    deleteEndpoint: { type: String, default: undefined },
    headers: { type: Object as PropType<Record<string, string>>, default: undefined },
    withCredentials: { type: Boolean, default: undefined },
    locale: { type: String as PropType<UploadLocale>, default: undefined },
    uploadMode: { type: String as PropType<UploadMode>, default: undefined },
    maxSizeMB: { type: Number, default: undefined },
    maxDimensions: { type: Object as PropType<ImageDimensions>, default: undefined },
    allowedFormats: { type: Array as PropType<string[]>, default: undefined },
    accept: { type: String, default: DEFAULT_ACCEPT },
    outputFormat: { type: String as PropType<ExplicitOutputFormat>, default: undefined },
    quality: { type: [Number, String] as PropType<number | QualityLevel>, default: undefined },
    customFilename: { type: String, default: undefined },
    aspectRatio: { type: [String, Number] as PropType<ImageAspectRatio>, default: undefined },
    crop: { type: String as PropType<CropStrategy>, default: undefined },
    disabled: { type: Boolean, default: false },
    unstyled: { type: Boolean, default: false },
    requireAltText: { type: Boolean, default: undefined },
    label: { type: String, default: undefined },
    helperText: { type: String, default: undefined },
    error: { type: String, default: undefined },
    maxFiles: { type: Number, default: undefined },
    maxImages: { type: Number, default: undefined },
    minImages: { type: Number, default: undefined },
    maxParallelUploads: { type: Number, default: undefined },
    reorderable: { type: Boolean, default: true },
    showCoverBadge: { type: Boolean, default: true },
    coverBadgeLabel: { type: String, default: undefined },
    transformAsset: { type: Function as PropType<TransformAssetFn<File>>, default: undefined },
    customUploader: { type: Function as PropType<CustomUploaderFn>, default: undefined },
    uploader: { type: Function as PropType<CustomUploaderFn>, default: undefined },
    customDeleter: { type: Function as PropType<CustomDeleterFn>, default: undefined },
  },
  emits: [
    'update:modelValue', 'change', 'reorder', 'upload-start',
    'upload-complete', 'upload-cancel', 'error', 'blur',
  ],
  setup(props, { emit, slots, expose }) {
    const inputRef = ref<HTMLInputElement | null>(null);
    const gridRef = ref<HTMLElement | null>(null);
    const cfg = useImageUploadConfig({ locale: props.locale, unstyled: props.unstyled });

    const callbacks: Partial<VueMultiUploadOptions> = {
      onChange: (images) => { emit('update:modelValue', images); emit('change', images); },
      onReorder: (images, detail) => emit('reorder', images, detail),
      onUploadStart: (files) => emit('upload-start', files),
      onUploadComplete: (results) => emit('upload-complete', results),
      onUploadCancel: (id) => emit('upload-cancel', id),
      onError: (err) => emit('error', err),
      onBlur: () => emit('blur'),
    };
    const liveOptions = new Proxy(props as unknown as VueMultiUploadOptions, {
      get(_target, prop) {
        if (prop === 'value') return props.modelValue !== undefined ? props.modelValue : props.value;
        if (prop in callbacks) return callbacks[prop as keyof typeof callbacks];
        return (props as Record<PropertyKey, unknown>)[prop];
      },
    });
    const ctrl = useMultiUpload(liveOptions);

    watch(
      () => (props.modelValue !== undefined ? props.modelValue : props.value),
      (nextVal) => {
        if (nextVal === undefined || nextVal === ctrl.value.value) return;
        const nextUrls = nextVal.map((x) => x.url).join('\0');
        const currUrls = ctrl.value.value.map((x) => x.url).join('\0');
        if (nextUrls !== currUrls) ctrl.setValue(nextVal);
      },
    );
    watch(() => props.disabled, (nextDisabled) => ctrl.setDisabled(Boolean(nextDisabled)));

    let detachPointer: (() => void) | null = null;
    const bindPointerReorder = () => {
      detachPointer?.();
      detachPointer = null;
      if (gridRef.value && typeof window !== 'undefined') {
        detachPointer = attachPointerReorder(gridRef.value, {
          disabled: () => ctrl.disabled.value || !ctrl.reorderable,
          onMove: (fromIndex, toIndex) => ctrl.move(fromIndex, toIndex),
        });
      }
    };
    onMounted(bindPointerReorder);
    watch(gridRef, bindPointerReorder);
    onBeforeUnmount(() => { detachPointer?.(); detachPointer = null; });

    const openFileDialog = () => { if (!ctrl.disabled.value) inputRef.value?.click(); };
    expose({ controller: ctrl, openFileDialog });

    return () => {
      const resolvedLocale: UploadLocale = props.locale ?? cfg.locale ?? 'en';
      const ui = resolveTranslations(resolvedLocale);
      const unstyled = Boolean(props.unstyled ?? cfg.unstyled);
      const c = (name: string) => (unstyled ? undefined : name);
      const st = ctrl.state.value;
      const list = ctrl.items.value;
      const isDisabled = ctrl.disabled.value;
      const err = ctrl.error.value;
      const cssAspect = aspectRatioToCss(props.aspectRatio);

      const slotCtx = {
        controller: ctrl, items: list, value: ctrl.value.value, state: st,
        isUploading: ctrl.isUploading.value, progress: ctrl.progress.value,
        canAddMore: ctrl.canAddMore.value, openFileDialog,
        move: ctrl.move, setCover: ctrl.setCover, clearAll: ctrl.clearAll,
      };

      const makeActionBtn = (slot: string, ariaLabel: string, onClick: () => void, btnDisabled = false, className?: string) =>
        h('button', {
          type: 'button', 'data-slot': slot, 'aria-label': ariaLabel, disabled: btnDisabled, class: className,
          onClick: (e: MouseEvent) => { e.stopPropagation(); onClick(); },
        });

      let bodyContent: VNodeChild;
      if (list.length === 0) {
        bodyContent = slots.empty
          ? slots.empty(slotCtx)
          : h('div', { 'data-slot': 'empty-dropzone', 'data-state': st, class: c('iuk-multi__empty') }, [
              h('button', {
                type: 'button', 'data-slot': 'select-files-btn', 'aria-label': ui.selectFilesAria,
                disabled: isDisabled, class: c('iuk-btn iuk-btn--primary'),
                onClick: (e: MouseEvent) => { e.stopPropagation(); openFileDialog(); },
              }, ui.selectFiles),
            ]);
      } else {
        const tiles = list.map((item, index) => {
          if (slots.tile) {
            return slots.tile({
              item, index, isCover: index === 0, move: ctrl.move, setCover: ctrl.setCover,
              remove: () => ctrl.removeItem(item.id), retry: () => ctrl.retryItem(item.id), cancel: () => ctrl.cancelItem(item.id),
            });
          }
          const itemState = item.error ? 'error' : item.isUploading ? 'uploading' : 'ready';
          const mediaChildren: VNodeChild[] = [h('img', { src: item.url, alt: item.altText ?? '' })];
          if (index === 0 && ctrl.showCoverBadge) {
            mediaChildren.push(h('span', { 'data-slot': 'cover-badge', class: c('iuk-tile__badge iuk-tile__badge--cover') }, ctrl.coverBadgeLabel));
          }
          if (ctrl.reorderable && !isDisabled && list.length > 1) {
            mediaChildren.push(
              makeActionBtn('tile-drag-handle', ui.dragHandle, () => {}, false, c('iuk-tile__action iuk-tile__action--drag')),
              makeActionBtn('tile-move-earlier', ui.moveEarlier, () => ctrl.move(index, index - 1), index === 0),
              makeActionBtn('tile-move-later', ui.moveLater, () => ctrl.move(index, index + 1), index === list.length - 1),
            );
            if (index > 0) mediaChildren.push(makeActionBtn('tile-set-cover', ui.setAsCover, () => ctrl.setCover(index)));
          }
          if (!isDisabled) {
            if (item.isUploading) {
              mediaChildren.push(makeActionBtn('tile-cancel', ui.cancelUpload, () => ctrl.cancelItem(item.id)));
            } else if (item.error && item.file) {
              mediaChildren.push(makeActionBtn('tile-retry', ui.retryUpload, () => void ctrl.retryItem(item.id)));
            }
            mediaChildren.push(makeActionBtn('tile-remove-btn', ui.removeImageAria, () => void ctrl.removeItem(item.id)));
          }
          return h(
            'div',
            {
              key: item.id, 'data-slot': 'tile', 'data-index': String(index), 'data-state': itemState,
              tabindex: 0, class: c('iuk-tile'), style: cssAspect ? { aspectRatio: cssAspect } : undefined,
              onKeydown: (e: KeyboardEvent) => {
                if (!ctrl.reorderable || isDisabled || !e.altKey) return;
                if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && index > 0) {
                  e.preventDefault(); ctrl.move(index, index - 1);
                } else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && index < list.length - 1) {
                  e.preventDefault(); ctrl.move(index, index + 1);
                } else if (e.key === 'Home' && index > 0) {
                  e.preventDefault(); ctrl.setCover(index);
                }
              },
            },
            [h('div', { 'data-slot': 'tile-media', class: c('iuk-tile__media') }, mediaChildren)],
          );
        });

        const addMoreSlot = slots['add-more'] ?? slots.addMore;
        const addMoreNode = ctrl.canAddMore.value
          ? addMoreSlot
            ? addMoreSlot(slotCtx)
            : h('button', {
                type: 'button', 'data-slot': 'add-more-btn', 'aria-label': ui.selectMoreFilesAria,
                disabled: isDisabled, class: c('iuk-btn iuk-btn--secondary'), onClick: openFileDialog,
              }, ui.addMore)
          : null;

        bodyContent = [h('div', { ref: gridRef, 'data-slot': 'grid', class: c('iuk-multi__grid') }, tiles), addMoreNode];
      }

      return h(
        'div',
        {
          'data-slot': 'multi-root',
          'data-state': st,
          dir: resolvedLocale === 'ar' ? 'rtl' : undefined,
          class: c('iuk-multi'),
          onDragenter: (e: DragEvent) => {
            e.preventDefault();
            if (!isDisabled && ctrl.canAddMore.value) ctrl.setDragging(true);
          },
          onDragover: (e: DragEvent) => {
            e.preventDefault();
            if (!isDisabled && ctrl.canAddMore.value) ctrl.setDragging(true);
          },
          onDragleave: () => ctrl.setDragging(false),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            ctrl.setDragging(false);
            if (!isDisabled && ctrl.canAddMore.value && e.dataTransfer?.files?.length) {
              void ctrl.addFiles(e.dataTransfer.files);
            }
          },
        },
        [
          h('div', {
            'data-slot': 'live-region', role: 'status', 'aria-live': 'polite',
            'aria-atomic': 'true', style: HIDDEN_INPUT_STYLE,
          }, ctrl.liveAnnouncement.value),
          h('input', {
            ref: inputRef, type: 'file', multiple: true, 'data-slot': 'file-input',
            accept: props.accept ?? DEFAULT_ACCEPT, disabled: isDisabled,
            'aria-label': props.label ?? ui.selectFilesAria, style: HIDDEN_INPUT_STYLE,
            onChange: (e: Event) => {
              const target = e.target as HTMLInputElement;
              if (target.files && target.files.length > 0) void ctrl.addFiles(target.files);
              target.value = '';
            },
          }),
          slots.header ? slots.header(slotCtx) : null,
          bodyContent,
          err ? h('p', { 'data-slot': 'error-text', role: 'alert', class: c('iuk-helper-text iuk-helper-text--error') }, err) : null,
        ],
      );
    };
  },
});

export const IukMultiImageUpload = MultiImageUpload;
