import { defineComponent, h, type PropType, ref, type VNodeChild, watch } from 'vue';
import { resolveTranslations } from '../../i18n';
import {
  aspectRatioToCss, type CropStrategy, type ExplicitOutputFormat, type ImageAspectRatio,
  type ImageDimensions, type QualityLevel, type UploadedImageData, type UploadLocale, type UploadPresetName,
} from '../../types';
import { useImageUploadConfig } from '../config';
import { useSingleUpload } from '../composables/useSingleUpload';
import type {
  CustomDeleterFn, CustomUploaderFn, TransformAssetFn, UploadMode, VueSingleUploadOptions,
} from '../types';

export const HIDDEN_INPUT_STYLE: Record<string, string> = {
  position: 'absolute', width: '1px', height: '1px', padding: '0',
  margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap', border: '0',
};

export const DEFAULT_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/svg+xml';

export const SingleImageUpload = defineComponent({
  name: 'IukSingleImageUpload',
  props: {
    modelValue: { type: [Object, String] as PropType<UploadedImageData | string | null>, default: undefined },
    value: { type: [Object, String] as PropType<UploadedImageData | string | null>, default: undefined },
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
    initialAltText: { type: String, default: undefined },
    showProgress: { type: Boolean, default: true },
    transformAsset: { type: Function as PropType<TransformAssetFn<File>>, default: undefined },
    customUploader: { type: Function as PropType<CustomUploaderFn>, default: undefined },
    uploader: { type: Function as PropType<CustomUploaderFn>, default: undefined },
    customDeleter: { type: Function as PropType<CustomDeleterFn>, default: undefined },
  },
  emits: [
    'update:modelValue',
    'change',
    'upload-start',
    'upload-complete',
    'error',
    'blur',
  ],
  setup(props, { emit, slots, expose }) {
    const inputRef = ref<HTMLInputElement | null>(null);
    const cfg = useImageUploadConfig({ locale: props.locale, unstyled: props.unstyled });

    const callbacks: Partial<VueSingleUploadOptions> = {
      onChange: (next) => { emit('update:modelValue', next); emit('change', next); },
      onUploadStart: (file) => emit('upload-start', file),
      onUploadComplete: (data) => emit('upload-complete', data),
      onError: (err) => emit('error', err),
      onBlur: () => emit('blur'),
    };
    const liveOptions = new Proxy(props as unknown as VueSingleUploadOptions, {
      get(_target, prop) {
        if (prop === 'value') return props.modelValue !== undefined ? props.modelValue : props.value;
        if (prop in callbacks) return callbacks[prop as keyof typeof callbacks];
        return (props as Record<PropertyKey, unknown>)[prop];
      },
    });
    const ctrl = useSingleUpload(liveOptions);

    watch(
      () => (props.modelValue !== undefined ? props.modelValue : props.value),
      (nextVal) => {
        if (nextVal !== undefined && nextVal !== ctrl.value.value) {
          ctrl.setValue(nextVal);
        }
      },
    );

    watch(() => props.disabled, (nextDisabled) => ctrl.setDisabled(Boolean(nextDisabled)));

    const openFileDialog = () => { if (!ctrl.disabled.value) inputRef.value?.click(); };
    expose({ controller: ctrl, openFileDialog });

    return () => {
      const resolvedLocale: UploadLocale = props.locale ?? cfg.locale ?? 'en';
      const ui = resolveTranslations(resolvedLocale);
      const unstyled = Boolean(props.unstyled ?? cfg.unstyled);
      const c = (name: string) => (unstyled ? undefined : name);
      const st = ctrl.state.value;
      const preview = ctrl.previewUrl.value;
      const err = ctrl.error.value;
      const isDisabled = ctrl.disabled.value;
      const uploading = ctrl.isUploading.value;
      const cssAspect = aspectRatioToCss(props.aspectRatio);

      const slotProps = {
        controller: ctrl,
        state: st,
        previewUrl: preview,
        value: ctrl.value.value,
        isUploading: uploading,
        progress: ctrl.progress.value,
        error: err,
        openFileDialog,
        clear: ctrl.clear,
        cancel: ctrl.cancel,
        retry: ctrl.retry,
      };

      const dropzoneClass = unstyled
        ? undefined
        : [
            'iuk-dropzone',
            preview ? 'iuk-dropzone--has-image' : '',
            isDisabled ? 'iuk-dropzone--disabled' : '',
            err ? 'iuk-dropzone--error' : '',
          ]
            .filter(Boolean)
            .join(' ');

      let dropzoneContent: VNodeChild;
      if (slots.default) {
        dropzoneContent = slots.default(slotProps);
      } else if (preview) {
        if (slots.preview) {
          dropzoneContent = slots.preview(slotProps);
        } else {
          const actions: VNodeChild[] = [];
          if (!isDisabled) {
            if (uploading) {
              actions.push(
                h('button', {
                  type: 'button',
                  'data-slot': 'tile-cancel',
                  'aria-label': ui.cancelUpload,
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    ctrl.cancel();
                  },
                }),
              );
            } else {
              actions.push(
                h('button', {
                  type: 'button',
                  'data-slot': 'tile-remove-btn',
                  'aria-label': ui.removeImageAria,
                  class: c('iuk-tile__action iuk-tile__action--remove'),
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    void ctrl.clear();
                  },
                }),
              );
            }
          }
          dropzoneContent = h(
            'div',
            { 'data-slot': 'preview-wrap', class: c('iuk-single__preview-wrap') },
            [
              h(
                'div',
                { 'data-slot': 'tile', 'data-state': st, class: c('iuk-tile') },
                [
                  h(
                    'div',
                    { 'data-slot': 'tile-media', class: c('iuk-tile__media') },
                    [
                      h('img', {
                        src: preview,
                        alt: ctrl.altText.value || ui.previewAlt,
                      }),
                      ...actions,
                    ],
                  ),
                ],
              ),
            ],
          );
        }
      } else if (slots.dropzone) {
        dropzoneContent = slots.dropzone(slotProps);
      } else {
        const msg = uploading
          ? ctrl.uploadStatus.value || `${ui.uploading}...`
          : ui.dragDropOrClickToUpload;
        dropzoneContent = h(
          'div',
          { 'data-slot': 'dropzone-prompt', class: c('iuk-dropzone__prompt') },
          [
            h(
              'p',
              { 'data-slot': 'dropzone-text', class: c('iuk-dropzone__text') },
              msg,
            ),
          ],
        );
      }

      return h(
        'div',
        {
          'data-slot': 'single-root',
          'data-state': st,
          dir: resolvedLocale === 'ar' ? 'rtl' : undefined,
          class: c('iuk-single'),
        },
        [
          h('input', {
            ref: inputRef,
            type: 'file',
            'data-slot': 'file-input',
            accept: props.accept ?? DEFAULT_ACCEPT,
            disabled: isDisabled,
            'aria-label': props.label ?? ui.uploadImageAria,
            style: HIDDEN_INPUT_STYLE,
            onChange: (e: Event) => {
              const target = e.target as HTMLInputElement;
              const file = target.files?.[0];
              if (file) void ctrl.selectFile(file);
              target.value = '';
            },
          }),
          h(
            'div',
            {
              'data-slot': 'dropzone',
              'data-state': st,
              class: dropzoneClass,
              style: cssAspect ? { aspectRatio: cssAspect } : undefined,
              onClick: () => {
                if (!isDisabled && !preview) openFileDialog();
              },
              onDragenter: (e: DragEvent) => {
                e.preventDefault();
                if (!isDisabled) ctrl.setDragging(true);
              },
              onDragover: (e: DragEvent) => {
                e.preventDefault();
              },
              onDragleave: () => {
                ctrl.setDragging(false);
              },
              onDrop: (e: DragEvent) => {
                e.preventDefault();
                ctrl.setDragging(false);
                const file = e.dataTransfer?.files?.[0];
                if (!isDisabled && file) void ctrl.selectFile(file);
              },
            },
            [dropzoneContent],
          ),
          err
            ? h(
                'p',
                {
                  'data-slot': 'error-text',
                  role: 'alert',
                  class: c('iuk-helper-text iuk-helper-text--error'),
                },
                err,
              )
            : null,
        ],
      );
    };
  },
});

export const IukSingleImageUpload = SingleImageUpload;
