import { aspectRatioToCss } from '../../types';
import {
  type AngularImageRevealController,
  createImageReveal,
  DEFAULT_NEUTRAL_COLORS,
  resolveBackgroundColor,
} from '../controllers/imageReveal';
import type { AnimatedImageObjectFit, AngularAnimatedImageOptions } from '../types';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

function applyStyleRecord(
  el: HTMLElement,
  styles?: Record<string, string | number | undefined>,
): void {
  if (!styles) return;
  for (const [key, val] of Object.entries(styles)) {
    if (val === undefined) continue;
    if (key.startsWith('--') || key.includes('-')) el.style.setProperty(key, String(val));
    else (el.style as unknown as Record<string, string>)[key] = String(val);
  }
}

export interface MountedAnimatedImage {
  element: HTMLDivElement;
  imgElement: HTMLImageElement;
  controller: AngularImageRevealController;
  update: (nextOptions: Partial<AngularAnimatedImageOptions>) => void;
  destroy: () => void;
}

export function mountAnimatedImage(
  host: HTMLElement,
  initialOptions: AngularAnimatedImageOptions,
): MountedAnimatedImage {
  let opts: AngularAnimatedImageOptions = { ...initialOptions };
  const resolvedObjectFit: AnimatedImageObjectFit =
    (opts.style?.objectFit as AnimatedImageObjectFit | undefined) ?? opts.objectFit ?? 'cover';

  const controller = createImageReveal({ ...opts, objectFit: resolvedObjectFit });
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-slot', 'animated-image');

  let placeholderEl: HTMLImageElement | null = null;
  let shimmerEl: HTMLDivElement | null = null;
  let errorEl: HTMLElement | null = null;
  const imgEl = document.createElement('img');

  const preventDrag = (e: Event) => e.preventDefault();
  imgEl.addEventListener('dragstart', preventDrag);
  imgEl.addEventListener('load', () => controller.handleLoad(imgEl));
  imgEl.addEventListener('error', () => { controller.handleError(); });

  const syncDom = () => {
    const unstyled = Boolean(opts.unstyled);
    const cls = (name: string) => (unstyled ? undefined : name);
    const fill = Boolean(opts.fill);
    const objFit: AnimatedImageObjectFit =
      (opts.style?.objectFit as AnimatedImageObjectFit | undefined) ?? opts.objectFit ?? 'cover';
    const isContain = objFit === 'contain';
    const duration = Math.max(0, opts.animationDuration ?? 600);
    const placeholderFadeDuration = Math.round(duration * (5 / 6));
    const revealScale = opts.revealScale ?? 1.02;
    const state = controller.state();
    const isLoaded = controller.isLoaded();
    const hasError = controller.hasError();
    const showPlaceholder = controller.showPlaceholder();

    wrapper.setAttribute('data-state', state);
    if (state === 'loading') wrapper.setAttribute('aria-busy', 'true');
    else wrapper.removeAttribute('aria-busy');

    const wrapperClass = cx(
      cls('iuk-animated-image'),
      fill && cls('iuk-animated-image--fill'),
      isContain && cls('iuk-animated-image--contain'),
      opts.wrapperClassName,
    );
    if (wrapperClass) wrapper.className = wrapperClass;
    else wrapper.removeAttribute('class');

    const blurColor = opts.blurColor ?? opts.image?.blurColor;
    const neutralColors = opts.neutralColors ?? DEFAULT_NEUTRAL_COLORS;
    const bg =
      resolveBackgroundColor(blurColor, neutralColors) ??
      (unstyled ? undefined : 'var(--iuk-animated-image-bg, var(--background-card, rgba(38, 45, 56, 0.4)))');
    if (bg) wrapper.style.backgroundColor = bg;
    if (!unstyled) {
      wrapper.style.setProperty('--iuk-animated-image-duration', `${duration}ms`);
      wrapper.style.setProperty('--iuk-ai-ph-dur', `${placeholderFadeDuration}ms`);
      wrapper.style.setProperty('--iuk-animated-image-reveal-scale', String(revealScale));
    }
    const cssAspect = aspectRatioToCss(opts.aspectRatio);
    if (cssAspect) wrapper.style.aspectRatio = cssAspect;
    applyStyleRecord(wrapper, opts.wrapperStyle);

    // 1. Placeholder <img>
    const shouldMountPlaceholder = (showPlaceholder || isContain) && Boolean(controller.placeholderUrl);
    if (shouldMountPlaceholder && controller.placeholderUrl) {
      if (!placeholderEl) {
        placeholderEl = document.createElement('img');
        placeholderEl.alt = '';
        placeholderEl.setAttribute('aria-hidden', 'true');
        placeholderEl.draggable = false;
        placeholderEl.addEventListener('dragstart', preventDrag);
        placeholderEl.setAttribute('data-slot', 'animated-image-placeholder');
        wrapper.insertBefore(placeholderEl, wrapper.firstChild);
      }
      placeholderEl.src = controller.placeholderUrl;
      const phClass = cx(
        cls('iuk-animated-image__placeholder'),
        isLoaded && !isContain && cls('iuk-animated-image__placeholder--hidden'),
        opts.placeholderClassName,
      );
      if (phClass) placeholderEl.className = phClass;
      else placeholderEl.removeAttribute('class');
      placeholderEl.style.objectFit = 'cover';
      placeholderEl.style.transitionDuration = `${placeholderFadeDuration}ms`;
    } else if (placeholderEl) {
      placeholderEl.remove();
      placeholderEl = null;
    }

    // 2. Shimmer <div>
    if (Boolean(opts.showShimmer) && !isLoaded && !hasError) {
      if (!shimmerEl) {
        shimmerEl = document.createElement('div');
        shimmerEl.setAttribute('aria-hidden', 'true');
        shimmerEl.setAttribute('data-slot', 'animated-image-shimmer');
        wrapper.insertBefore(shimmerEl, imgEl);
      }
      const shimClass = cx(cls('iuk-animated-image__shimmer'));
      if (shimClass) shimmerEl.className = shimClass;
      else shimmerEl.removeAttribute('class');
    } else if (shimmerEl) {
      shimmerEl.remove();
      shimmerEl = null;
    }

    // 3. Main <img>
    const src = opts.src ?? opts.image?.url ?? '';
    const activeSrc = controller.activeSrc();
    if (imgEl.getAttribute('src') !== activeSrc) imgEl.setAttribute('src', activeSrc);
    imgEl.alt = opts.alt ?? opts.image?.altText ?? '';
    imgEl.decoding = opts.decoding ?? 'async';
    imgEl.draggable = opts.draggable ?? false;
    imgEl.setAttribute('loading', opts.priority ? 'eager' : (opts.loading ?? 'lazy'));
    if (opts.priority) imgEl.setAttribute('fetchpriority', 'high');
    else imgEl.removeAttribute('fetchpriority');

    const width = opts.width ?? (!fill ? opts.image?.width : undefined);
    const height = opts.height ?? (!fill ? opts.image?.height : undefined);
    if (width !== undefined) imgEl.width = width;
    if (height !== undefined) imgEl.height = height;

    const derivedSrcSet =
      activeSrc === src
        ? (opts.image?.srcSet ??
          (opts.image?.variants?.length
            ? [
                ...[...opts.image.variants].sort((a, b) => a.width - b.width).map((v) => `${v.url} ${v.width}w`),
                ...(opts.image.width ? [`${src} ${opts.image.width}w`] : []),
              ].join(', ')
            : undefined))
        : undefined;
    const resolvedSrcSet = opts.srcSet ?? derivedSrcSet;
    if (resolvedSrcSet) imgEl.srcset = resolvedSrcSet;
    const resolvedSizes = resolvedSrcSet && fill && opts.sizes === undefined ? '100vw' : opts.sizes;
    if (resolvedSizes) imgEl.sizes = resolvedSizes;

    const imgClass = cx(cls('iuk-animated-image__img'), opts.className);
    if (imgClass) imgEl.className = imgClass;
    else imgEl.removeAttribute('class');
    imgEl.setAttribute('data-state', state);

    imgEl.style.objectFit = objFit;
    imgEl.style.objectPosition = opts.objectPosition ?? 'center';
    imgEl.style.transitionDuration = `${duration}ms`;
    applyStyleRecord(imgEl, opts.style);
    if (hasError) {
      imgEl.style.opacity = '0';
      imgEl.style.visibility = 'hidden';
    } else {
      imgEl.style.removeProperty('opacity');
      imgEl.style.removeProperty('visibility');
    }

    // 4. Error fallback overlay
    if (hasError && opts.renderError) {
      if (!errorEl) {
        const rendered = opts.renderError({ src: activeSrc, retry: () => controller.retry() });
        if (typeof rendered === 'string') {
          errorEl = document.createElement('div');
          errorEl.textContent = rendered;
        } else if (rendered instanceof HTMLElement) {
          errorEl = rendered;
        }
        if (errorEl) wrapper.appendChild(errorEl);
      }
    } else if (errorEl) {
      errorEl.remove();
      errorEl = null;
    }
  };

  wrapper.appendChild(imgEl);
  host.appendChild(wrapper);
  syncDom();

  const unsubs = [
    controller.state.subscribe(syncDom),
    controller.isLoaded.subscribe(syncDom),
    controller.showPlaceholder.subscribe(syncDom),
    controller.hasError.subscribe(syncDom),
    controller.activeSrc.subscribe(syncDom),
  ];

  return {
    element: wrapper, imgElement: imgEl, controller,
    update: (nextOptions: Partial<AngularAnimatedImageOptions>) => {
      opts = { ...opts, ...nextOptions };
      syncDom();
    },
    destroy: () => {
      for (const unsub of unsubs) unsub();
      controller.destroy();
      wrapper.remove();
    },
  };
}

export class AnimatedImageComponent {
  private mounted: MountedAnimatedImage | null = null;
  constructor(host?: HTMLElement, options?: AngularAnimatedImageOptions) {
    if (host && options) this.mounted = mountAnimatedImage(host, options);
  }
  mount(host: HTMLElement, options: AngularAnimatedImageOptions): MountedAnimatedImage {
    this.destroy();
    this.mounted = mountAnimatedImage(host, options);
    return this.mounted;
  }
  update(options: Partial<AngularAnimatedImageOptions>): void { this.mounted?.update(options); }
  ngOnDestroy(): void { this.destroy(); }
  destroy(): void { this.mounted?.destroy(); this.mounted = null; }
}
