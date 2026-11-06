import { defineComponent, type PropType, watch } from 'vue';
import type { UploadedImageData, UploadPresetName } from '../../types';
import { useMultiUpload } from '../composables/useMultiUpload';
import { useSingleUpload } from '../composables/useSingleUpload';
import type { VueMultiUploadOptions, VueSingleUploadOptions } from '../types';

export const HeadlessSingleUpload = defineComponent({
  name: 'IukHeadlessSingleUpload',
  props: {
    modelValue: {
      type: [Object, String] as PropType<UploadedImageData | string | null>,
      default: undefined,
    },
    value: {
      type: [Object, String] as PropType<UploadedImageData | string | null>,
      default: undefined,
    },
    preset: { type: String as PropType<UploadPresetName>, default: undefined },
    endpoint: { type: String, default: undefined },
    deleteEndpoint: { type: String, default: undefined },
    disabled: { type: Boolean, default: false },
    requireAltText: { type: Boolean, default: undefined },
    options: {
      type: Object as PropType<VueSingleUploadOptions>,
      default: undefined,
    },
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit, slots, expose }) {
    const ctrl = useSingleUpload({
      ...props.options,
      preset: props.preset ?? props.options?.preset,
      endpoint: props.endpoint ?? props.options?.endpoint,
      deleteEndpoint: props.deleteEndpoint ?? props.options?.deleteEndpoint,
      disabled: props.disabled || props.options?.disabled,
      requireAltText: props.requireAltText ?? props.options?.requireAltText,
      value:
        props.modelValue !== undefined
          ? props.modelValue
          : (props.value ?? props.options?.value),
      onChange: (next) => {
        props.options?.onChange?.(next);
        emit('update:modelValue', next);
        emit('change', next);
      },
    });

    watch(
      () => (props.modelValue !== undefined ? props.modelValue : props.value),
      (nextVal) => {
        if (nextVal !== undefined && nextVal !== ctrl.value.value) {
          ctrl.setValue(nextVal);
        }
      },
    );

    expose({ controller: ctrl });
    return () => slots.default?.(ctrl) ?? null;
  },
});

export const HeadlessMultiUpload = defineComponent({
  name: 'IukHeadlessMultiUpload',
  props: {
    modelValue: { type: Array as PropType<UploadedImageData[]>, default: undefined },
    value: { type: Array as PropType<UploadedImageData[]>, default: undefined },
    preset: { type: String as PropType<UploadPresetName>, default: undefined },
    endpoint: { type: String, default: undefined },
    deleteEndpoint: { type: String, default: undefined },
    disabled: { type: Boolean, default: false },
    reorderable: { type: Boolean, default: true },
    showCoverBadge: { type: Boolean, default: true },
    requireAltText: { type: Boolean, default: undefined },
    options: {
      type: Object as PropType<VueMultiUploadOptions>,
      default: undefined,
    },
  },
  emits: ['update:modelValue', 'change', 'reorder'],
  setup(props, { emit, slots, expose }) {
    const ctrl = useMultiUpload({
      ...props.options,
      preset: props.preset ?? props.options?.preset,
      endpoint: props.endpoint ?? props.options?.endpoint,
      deleteEndpoint: props.deleteEndpoint ?? props.options?.deleteEndpoint,
      disabled: props.disabled || props.options?.disabled,
      reorderable: props.reorderable ?? props.options?.reorderable,
      showCoverBadge: props.showCoverBadge ?? props.options?.showCoverBadge,
      requireAltText: props.requireAltText ?? props.options?.requireAltText,
      value:
        props.modelValue !== undefined
          ? props.modelValue
          : (props.value ?? props.options?.value),
      onChange: (images) => {
        props.options?.onChange?.(images);
        emit('update:modelValue', images);
        emit('change', images);
      },
      onReorder: (images, detail) => {
        props.options?.onReorder?.(images, detail);
        emit('reorder', images, detail);
      },
    });

    watch(
      () => (props.modelValue !== undefined ? props.modelValue : props.value),
      (nextVal) => {
        if (nextVal === undefined || nextVal === ctrl.value.value) return;
        const nextUrls = nextVal.map((x) => x.url).join('\0');
        const currUrls = ctrl.value.value.map((x) => x.url).join('\0');
        if (nextUrls !== currUrls) {
          ctrl.setValue(nextVal);
        }
      },
    );

    expose({ controller: ctrl });
    return () => slots.default?.(ctrl) ?? null;
  },
});
