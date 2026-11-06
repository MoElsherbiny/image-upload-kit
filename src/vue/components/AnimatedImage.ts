import {
  type Component,
  defineComponent,
  h,
  type PropType,
  type VNodeChild,
} from 'vue';
import { aspectRatioToCss, type ImageAspectRatio } from '../../types';
import {
  DEFAULT_NEUTRAL_COLORS,
  resolveBackgroundColor,
  useImageReveal,
} from '../composables/useImageReveal';
import type {
  AnimatedImageColorPlaceholder,
  AnimatedImageObjectFit,
  AnimatedImageSource,
} from '../types';

function cx(...classes: Array<string | false | null | undefined>): string | undefined {
  const joined = classes.filter(Boolean).join(' ');
  return joined || undefined;
}

const preventDrag = (event: Event) => {
  event.preventDefault();
};

export const AnimatedImage = defineComponent({
  name: 'IukAnimatedImage',
  inheritAttrs: false,
  props: {
    image: { type: Object as PropType<AnimatedImageSource>, default: undefined },
    src: { type: String, default: undefined },
    alt: { type: String, default: undefined },
    blurDataUrl: { type: String as PropType<string | null>, default: undefined },
    blurHash: { type: String as PropType<string | null>, default: undefined },
    blurColor: { type: String as PropType<string | null>, default: undefined },
    colorPlaceholder: { type: String as PropType<AnimatedImageColorPlaceholder>, default: 'flat' },
    neutralColors: { type: Array as PropType<readonly string[]>, default: () => DEFAULT_NEUTRAL_COLORS },
    aspectRatio: { type: [String, Number] as PropType<ImageAspectRatio>, default: undefined },
    width: { type: Number, default: undefined },
    height: { type: Number, default: undefined },
    fill: { type: Boolean, default: false },
    priority: { type: Boolean, default: undefined },
    quality: { type: Number, default: undefined },
    objectFit: { type: String as PropType<AnimatedImageObjectFit>, default: 'cover' },
    objectPosition: { type: String, default: 'center' },
    showShimmer: { type: Boolean, default: false },
    animationDuration: { type: Number, default: 600 },
    revealScale: { type: Number, default: 1.02 },
    fallbackSrc: { type: String, default: undefined },
    renderError: {
      type: Function as PropType<(ctx: { src: string; retry: () => void }) => VNodeChild>,
      default: undefined,
    },
    as: { type: [String, Object, Function] as PropType<string | Component>, default: undefined },
    imageComponentProps: { type: Object as PropType<Record<string, unknown>>, default: undefined },
    srcSet: { type: String, default: undefined },
    sizes: { type: String, default: undefined },
    loading: { type: String as PropType<'lazy' | 'eager'>, default: undefined },
    decoding: { type: String as PropType<'async' | 'sync' | 'auto'>, default: 'async' },
    draggable: { type: Boolean, default: false },
    unstyled: { type: Boolean, default: false },
    wrapperClassName: { type: String, default: undefined },
    wrapperStyle: {
      type: Object as PropType<Record<string, string | number | undefined>>,
      default: undefined,
    },
    placeholderClassName: { type: String, default: undefined },
    className: { type: String, default: undefined },
    style: {
      type: Object as PropType<Record<string, string | number | undefined>>,
      default: undefined,
    },
    onLoad: { type: Function as PropType<(img: HTMLImageElement | null) => void>, default: undefined },
    onError: { type: Function as PropType<(event?: Event) => void>, default: undefined },
  },
  setup(props, { slots, expose }) {
    const reveal = useImageReveal(() => ({
      image: props.image,
      src: props.src,
      fallbackSrc: props.fallbackSrc,
      blurDataUrl: props.blurDataUrl,
      blurHash: props.blurHash,
      blurColor: props.blurColor,
      colorPlaceholder: props.colorPlaceholder,
      neutralColors: props.neutralColors,
      objectFit:
        (props.style?.objectFit as AnimatedImageObjectFit | undefined) ??
        props.objectFit,
      animationDuration: props.animationDuration,
      onLoad: props.onLoad,
      onError: props.onError,
    }));

    expose({ reveal, retry: reveal.retry });

    return () => {
      const src = props.src ?? props.image?.url ?? '';
      const alt = props.alt ?? props.image?.altText ?? '';
      const blurColor = props.blurColor ?? props.image?.blurColor;
      const neutralColors = props.neutralColors ?? DEFAULT_NEUTRAL_COLORS;
      const fill = Boolean(props.fill);
      const unstyled = Boolean(props.unstyled);
      const cls = (name: string) => (unstyled ? undefined : name);

      const resolvedObjectFit: AnimatedImageObjectFit =
        (props.style?.objectFit as AnimatedImageObjectFit | undefined) ??
        props.objectFit ??
        'cover';
      const isContain = resolvedObjectFit === 'contain';
      const duration = Math.max(0, props.animationDuration ?? 600);
      const placeholderFadeDuration = Math.round(duration * (5 / 6));
      const revealScale = props.revealScale ?? 1.02;

      const state = reveal.state.value;
      const isLoaded = reveal.isLoaded.value;
      const hasError = reveal.hasError.value;
      const showPlaceholder = reveal.showPlaceholder.value;
      const placeholderUrl = reveal.placeholderUrl.value;
      const activeSrc = reveal.effectiveSrc.value;

      const resolvedCssAspectRatio =
        props.aspectRatio !== undefined
          ? aspectRatioToCss(props.aspectRatio)
          : undefined;

      const containerStyle: Record<string, string | number | undefined> = {
        backgroundColor:
          resolveBackgroundColor(blurColor, neutralColors) ??
          (unstyled
            ? undefined
            : 'var(--iuk-animated-image-bg, var(--background-card, rgba(38, 45, 56, 0.4)))'),
        ...(resolvedCssAspectRatio ? { aspectRatio: resolvedCssAspectRatio } : {}),
        ...(unstyled
          ? {}
          : {
              '--iuk-animated-image-duration': `${duration}ms`,
              '--iuk-ai-ph-dur': `${placeholderFadeDuration}ms`,
              '--iuk-animated-image-reveal-scale': String(revealScale),
            }),
        ...props.wrapperStyle,
      };

      const children: VNodeChild[] = [];

      if ((showPlaceholder || isContain) && placeholderUrl) {
        children.push(
          h('img', {
            src: placeholderUrl,
            alt: '',
            'aria-hidden': 'true',
            draggable: false,
            onDragstart: preventDrag,
            'data-slot': 'animated-image-placeholder',
            class: cx(
              cls('iuk-animated-image__placeholder'),
              isLoaded && !isContain && cls('iuk-animated-image__placeholder--hidden'),
              props.placeholderClassName,
            ),
            style: { objectFit: 'cover', transitionDuration: `${placeholderFadeDuration}ms` },
          }),
        );
      }

      if (props.showShimmer && !isLoaded && !hasError) {
        children.push(
          h('div', {
            'aria-hidden': 'true',
            'data-slot': 'animated-image-shimmer',
            class: cx(cls('iuk-animated-image__shimmer')),
          }),
        );
      }

      const isCustom = Boolean(props.as);
      const width = props.width ?? (!fill ? props.image?.width : undefined);
      const height = props.height ?? (!fill ? props.image?.height : undefined);
      const loadingAttr = props.priority
        ? isCustom ? undefined : 'eager'
        : (props.loading ?? (isCustom ? undefined : 'lazy'));

      const derivedSrcSet =
        !isCustom && activeSrc === src
          ? (props.image?.srcSet ??
            (props.image?.variants?.length
              ? [
                  ...[...props.image.variants]
                    .sort((a, b) => a.width - b.width)
                    .map((v) => `${v.url} ${v.width}w`),
                  ...(props.image.width ? [`${src} ${props.image.width}w`] : []),
                ].join(', ')
              : undefined))
          : undefined;
      const resolvedSrcSet = props.srcSet ?? derivedSrcSet;
      const resolvedSizes =
        !isCustom && resolvedSrcSet && fill && props.sizes === undefined
          ? '100vw'
          : props.sizes;

      const imgAttrs: Record<string, unknown> = {
        key: reveal.retryKey.value > 0 ? reveal.retryKey.value : undefined,
        src: activeSrc,
        alt,
        decoding: props.decoding ?? 'async',
        draggable: props.draggable ?? false,
        ...(loadingAttr !== undefined ? { loading: loadingAttr } : {}),
        ...(props.priority && !isCustom ? { fetchpriority: 'high' } : {}),
        ...(isCustom && props.priority !== undefined ? { priority: props.priority } : {}),
        ...(isCustom && props.quality !== undefined ? { quality: props.quality } : {}),
        ...(isCustom && fill ? { fill: true } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(resolvedSrcSet !== undefined ? { srcset: resolvedSrcSet } : {}),
        ...(resolvedSizes !== undefined ? { sizes: resolvedSizes } : {}),
        class: cx(cls('iuk-animated-image__img'), props.className),
        style: {
          objectFit: resolvedObjectFit,
          objectPosition: props.objectPosition ?? 'center',
          transitionDuration: `${duration}ms`,
          ...props.style,
          ...(hasError ? { opacity: 0, visibility: 'hidden' } : {}),
        },
        'data-state': state,
        onDragstart: preventDrag,
        onLoad: (event: Event) => {
          reveal.handleLoad((event.currentTarget ?? event.target) as HTMLImageElement | null);
        },
        onError: (event: Event) => {
          reveal.handleError();
          if (reveal.hasError.value) props.onError?.(event);
        },
        ...(isCustom ? props.imageComponentProps : {}),
      };

      children.push(h((props.as ?? 'img') as string, imgAttrs));

      if (hasError) {
        const errorCtx = { src: activeSrc, retry: reveal.retry };
        if (slots.error) children.push(slots.error(errorCtx));
        else if (props.renderError) children.push(props.renderError(errorCtx));
      }

      return h(
        'div',
        {
          class: cx(
            cls('iuk-animated-image'),
            fill && cls('iuk-animated-image--fill'),
            isContain && cls('iuk-animated-image--contain'),
            props.wrapperClassName,
          ),
          style: containerStyle,
          'data-slot': 'animated-image',
          'data-state': state,
          ...(state === 'loading' ? { 'aria-busy': 'true' } : {}),
        },
        children,
      );
    };
  },
});

export const IukAnimatedImage = AnimatedImage;
