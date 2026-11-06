import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createComputed, createMultiUpload, createSignal, createSingleUpload,
  IMAGE_UPLOAD_CONFIG_TOKEN, injectImageUploadConfig, mountAnimatedImage,
  mountMultiImageUpload, mountSingleImageUpload, provideImageUploadConfig,
  resetImageUploadConfig, resolveImageUploadConfig, withAngularSignals,
} from '../../src/angular';
import { AnimatedImage } from '../../src/react';
import type { UploadedImageData } from '../../src/types';
import { installMockXhr } from '../helpers/mockXhr';

const SAMPLE_LQIP = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

function makeUploaded(overrides: Partial<UploadedImageData> = {}): UploadedImageData {
  return {
    url: 'https://cdn.example.com/item.webp', blurDataUrl: SAMPLE_LQIP, blurColor: '#3B82F6',
    altText: 'Product photo', width: 1200, height: 1500, format: 'webp',
    size: 42000, originalSize: 120000, contentHash: 'hash-1', uploadedAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}

describe('img-upload-kit/angular — Signals, DI, Controllers & DOM Parity', () => {
  afterEach(() => { resetImageUploadConfig(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('supports createSignal, createComputed, provideImageUploadConfig, resolveImageUploadConfig, and explicit options.config', () => {
    const count = createSignal(2);
    const doubled = createComputed(() => count() * 2, [count]);
    const observed: number[] = [];
    const unsub = doubled.subscribe((v) => observed.push(v));
    count.update((n) => n + 3);
    expect([count(), doubled(), observed]).toEqual([5, 10, [10]]);
    unsub();

    const provider = provideImageUploadConfig({
      endpoint: '/api/angular-upload', defaultPreset: 'square', locale: 'ar', headers: { 'x-tenant': 'acme' },
    });
    expect(provider.provide).toBe(IMAGE_UPLOAD_CONFIG_TOKEN);
    expect(provider.useValue.endpoint).toBe('/api/angular-upload');

    const injected = injectImageUploadConfig({ endpoint: '/api/override' });
    expect([injected.endpoint, injected.defaultPreset, injected.locale]).toEqual(['/api/override', 'square', 'ar']);
    expect(injected.headers).toEqual({ 'x-tenant': 'acme' });
    expect(resolveImageUploadConfig({ endpoint: '/api/alias' }).endpoint).toBe('/api/alias');

    const scopedCtrl = createSingleUpload({
      config: { locale: 'en', requireAltText: false, endpoint: '/api/scoped' }, value: makeUploaded({ altText: '' }),
    });
    expect([scopedCtrl.locale, scopedCtrl.missingAltText(), scopedCtrl.canSave()]).toEqual(['en', false, true]);
    scopedCtrl.destroy();
  });

  it('withAngularSignals bridges controller signals to Angular framework signal() factory and DestroyRef', () => {
    const ngSetCalls: Array<{ initial: unknown; value: unknown }> = [];
    let destroyCallback: (() => void) | null = null;
    const mockNgSignal = <T,>(initial: T) => {
      let current = initial;
      const fn = (() => current) as (() => T) & { set: (v: T) => void; asReadonly: () => () => T };
      fn.set = (v: T) => { current = v; ngSetCalls.push({ initial, value: v }); };
      fn.asReadonly = () => () => current;
      return fn;
    };

    const rawCtrl = createSingleUpload({ value: makeUploaded({ altText: '' }), requireAltText: true });
    const summary = createComputed(() => `${rawCtrl.state()}:${rawCtrl.altText()}`, [rawCtrl.state, rawCtrl.altText]);
    const bridged = withAngularSignals({ ...rawCtrl, summary }, {
      signal: mockNgSignal, destroyRef: { onDestroy: (cb) => { destroyCallback = cb; } },
    });
    expect(bridged.missingAltText()).toBe(true);
    expect(bridged.canSave()).toBe(false);
    expect(bridged.summary()).toBe('ready:');

    bridged.setAltText('Accessible studio hero');
    expect(bridged.altText()).toBe('Accessible studio hero');
    expect(bridged.summary()).toBe('ready:Accessible studio hero');
    expect(bridged.missingAltText()).toBe(false);
    expect(bridged.canSave()).toBe(true);
    expect(ngSetCalls.some((c) => c.value === 'Accessible studio hero')).toBe(true);
    expect(ngSetCalls.some((c) => c.value === 'ready:Accessible studio hero')).toBe(true);
    expect(destroyCallback).toBeTypeOf('function');
    destroyCallback!();
  });

  it('createSingleUpload handles ControlValueAccessor, MockXHR, cancel, phase===transforming, and deleteEndpoint on clear()', async () => {
    const xhr = installMockXhr();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    try {
      const transformedEvents: string[] = [];
      let releaseTransform: (() => void) | null = null;
      const ctrl = createSingleUpload({
        endpoint: '/api/single', deleteEndpoint: '/api/single-delete', preset: 'square', requireAltText: true,
        transformAsset: async (file, ctx) => {
          transformedEvents.push(`${file.name}:${ctx.preset}:${ctx.index}`);
          await new Promise<void>((resolve) => { releaseTransform = resolve; });
          return new File(['transformed-bytes'], 'cropped.webp', { type: 'image/webp' });
        },
      });

      const cva = ctrl.toControlValueAccessor();
      const cvaChanges: Array<UploadedImageData | null> = [];
      cva.registerOnChange((val) => cvaChanges.push(val));

      cva.writeValue(makeUploaded({ url: 'https://cdn.example.com/seeded.webp', altText: '' }));
      expect(ctrl.value()?.url).toBe('https://cdn.example.com/seeded.webp');
      expect(ctrl.state()).toBe('ready');
      expect(ctrl.missingAltText()).toBe(true);
      expect(ctrl.canSave()).toBe(false);
      ctrl.setAltText('Seeded alt');
      expect(ctrl.missingAltText()).toBe(false);
      expect(ctrl.canSave()).toBe(true);

      cva.setDisabledState?.(true);
      expect(ctrl.disabled()).toBe(true);
      expect(ctrl.state()).toBe('disabled');
      cva.setDisabledState?.(false);

      const rawFile = new File(['raw-bytes'], 'raw.png', { type: 'image/png' });
      const uploadPromise = ctrl.selectFile(rawFile);
      expect(ctrl.phase()).toBe('transforming');
      releaseTransform!();
      await vi.waitFor(() => expect(xhr.pending()).toHaveLength(1));
      expect(ctrl.phase()).toBe('uploading');
      expect(ctrl.isUploading()).toBe(true);
      ctrl.cancel();
      expect(await uploadPromise).toBeNull();
      expect(ctrl.isUploading()).toBe(false);

      const secondPromise = ctrl.selectFile(rawFile);
      expect(ctrl.phase()).toBe('transforming');
      releaseTransform!();
      await vi.waitFor(() => expect(xhr.pending()).toHaveLength(1));
      const req = xhr.latest();
      req.progress(50, 100);
      expect(ctrl.progress()).toBeGreaterThan(0);

      req.respond(200, makeUploaded({ url: 'https://cdn.example.com/final.avif', altText: '' }));
      const result = await secondPromise;
      expect(result?.url).toBe('https://cdn.example.com/final.avif');
      expect(ctrl.phase()).toBe('ready');
      expect(transformedEvents).toContain('raw.png:square:0');
      expect(cvaChanges.at(-1)?.url).toBe('https://cdn.example.com/final.avif');

      await ctrl.clear();
      expect(fetchSpy).toHaveBeenCalledWith(
        `/api/single-delete?url=${encodeURIComponent('https://cdn.example.com/final.avif')}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
      ctrl.destroy();
    } finally {
      xhr.restore();
    }
  });

  it('createMultiUpload supports move, setCover, stable transformAsset queueIndex, retryFailed, alt/color helpers, and deleteEndpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const imgA = makeUploaded({ url: 'https://cdn.example.com/a.webp', contentHash: 'dup-hash', altText: '' });
    const imgB = makeUploaded({ url: 'https://cdn.example.com/b.webp', contentHash: 'dup-hash', altText: 'Shoe B' });
    const imgC = makeUploaded({ url: 'https://cdn.example.com/c.webp', contentHash: 'c', altText: 'Shoe C' });
    const reorders: Array<{ urls: string[]; fromIndex: number; toIndex: number }> = [];
    const transformIndices: string[] = [];
    let shouldFailSecond = true;

    const ctrl = createMultiUpload({
      value: [imgA, imgB], deleteEndpoint: '/api/multi-delete', requireAltText: true,
      transformAsset: async (file, ctx) => { transformIndices.push(`${file.name}:${ctx.index}`); return file; },
      customUploader: async (file) => {
        if (file.name === 'fail-once.webp' && shouldFailSecond) {
          shouldFailSecond = false;
          throw new Error('Temporary failure');
        }
        return makeUploaded({ url: `https://cdn.example.com/${file.name}`, contentHash: file.name, altText: 'Uploaded' });
      },
      onReorder: (images, detail) => {
        reorders.push({ urls: images.map((i) => i.url), fromIndex: detail.fromIndex, toIndex: detail.toIndex });
      },
    });

    expect(ctrl.items()[0]!.id).not.toBe(ctrl.items()[1]!.id);
    expect(ctrl.missingAltCount()).toBe(1);
    expect(ctrl.canSave()).toBe(false);
    ctrl.setItemAltText(ctrl.items()[0]!.id, 'Shoe A');
    ctrl.setItemBlurColor(ctrl.items()[0]!.id, '#10B981');
    expect(ctrl.missingAltCount()).toBe(0);
    expect(ctrl.canSave()).toBe(true);
    expect(ctrl.value()[0]?.blurColor).toBe('#10B981');

    const cva = ctrl.toControlValueAccessor();
    const cvaSnapshots: string[][] = [];
    cva.registerOnChange((list) => cvaSnapshots.push(list.map((i) => i.url)));

    await ctrl.addFiles([
      new File(['c'], 'c.webp', { type: 'image/webp' }),
      new File(['d'], 'fail-once.webp', { type: 'image/webp' }),
    ]);
    expect(transformIndices).toEqual(['c.webp:2', 'fail-once.webp:3']);
    expect(ctrl.items().find((i) => i.data?.url.endsWith('c.webp'))?.file).toBeUndefined();
    expect(ctrl.canSave()).toBe(false);

    await ctrl.retryFailed();
    expect(transformIndices).toContain('fail-once.webp:3');
    expect(ctrl.canSave()).toBe(true);

    ctrl.move(0, 2);
    ctrl.setCover(2);
    expect(ctrl.value()[0]?.url).toBe('https://cdn.example.com/a.webp');
    expect(reorders).toHaveLength(2);

    await ctrl.removeItem(ctrl.items()[0]!.id);
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/multi-delete?url=${encodeURIComponent('https://cdn.example.com/a.webp')}`,
      expect.objectContaining({ method: 'DELETE' }),
    );

    cva.writeValue([imgC]);
    expect(ctrl.value().map((i) => i.url)).toEqual(['https://cdn.example.com/c.webp']);
    expect(cvaSnapshots.length).toBeGreaterThanOrEqual(3);
    ctrl.destroy();
  });

  it('maintains 100% DOM parity between React <AnimatedImage /> and Angular mountAnimatedImage (including contain persistent blur)', async () => {
    vi.useFakeTimers();
    const { container: reactContainer } = render(
      <AnimatedImage src="https://cdn.example.com/lookbook.webp" alt="Lookbook" blurDataUrl={SAMPLE_LQIP} blurColor="#344040" objectFit="contain" aspectRatio="4:5" />,
    );
    const ngHost = document.createElement('div');
    document.body.appendChild(ngHost);
    const ngMounted = mountAnimatedImage(ngHost, {
      src: 'https://cdn.example.com/lookbook.webp', alt: 'Lookbook', blurDataUrl: SAMPLE_LQIP, blurColor: '#344040', objectFit: 'contain', aspectRatio: '4:5',
    });

    const reactWrap = reactContainer.querySelector<HTMLElement>('[data-slot="animated-image"]')!;
    const ngWrap = ngHost.querySelector<HTMLElement>('[data-slot="animated-image"]')!;
    expect(ngWrap.className).toBe(reactWrap.className);
    expect(ngWrap.getAttribute('data-state')).toBe(reactWrap.getAttribute('data-state'));
    expect(ngWrap.style.aspectRatio).toBe(reactWrap.style.aspectRatio);

    const reactMainImg = reactWrap.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    const ngMainImg = ngWrap.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    reactMainImg.decode = vi.fn(() => Promise.resolve());
    ngMainImg.decode = vi.fn(() => Promise.resolve());

    await act(async () => { fireEvent.load(reactMainImg); fireEvent.load(ngMainImg); });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(ngWrap.getAttribute('data-state')).toBe('loaded');
    const ngPh = ngWrap.querySelector<HTMLImageElement>('[data-slot="animated-image-placeholder"]')!;
    expect(ngPh).toBeTruthy();
    expect(ngPh.style.objectFit).toBe('cover');
    expect(ngPh).not.toHaveClass('iuk-animated-image__placeholder--hidden');
    ngMounted.destroy();
    ngHost.remove();
  });

  it('mounts MultiImageUpload & SingleImageUpload with Arabic RTL dir="rtl", localized liveAnnouncement, and pointer/keyboard reorder', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const first = makeUploaded({ url: 'https://cdn.example.com/1.webp', contentHash: '1' });
    const second = makeUploaded({ url: 'https://cdn.example.com/2.webp', contentHash: '2' });

    const mounted = mountMultiImageUpload(host, {
      value: [first, second], aspectRatio: '1:1', reorderable: true, showCoverBadge: true, locale: 'ar',
    });
    expect(mounted.element.dir).toBe('rtl');
    const tiles = host.querySelectorAll<HTMLElement>('[data-slot="tile"]');
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector('[data-slot="cover-badge"]')?.textContent).toBe('غلاف');
    expect(tiles[0].querySelector('[data-slot="tile-drag-handle"]')).toBeTruthy();

    fireEvent.click(tiles[1].querySelector<HTMLButtonElement>('[data-slot="tile-set-cover"]')!);
    expect(mounted.controller.value()[0]?.url).toBe('https://cdn.example.com/2.webp');
    expect(mounted.controller.liveAnnouncement()).toContain('غلاف');

    const updatedTiles = host.querySelectorAll<HTMLElement>('[data-slot="tile"]');
    fireEvent.keyDown(updatedTiles[0], { key: 'ArrowRight', altKey: true });
    expect(mounted.controller.value()[0]?.url).toBe('https://cdn.example.com/1.webp');

    const dragTiles = host.querySelectorAll<HTMLElement>('[data-slot="tile"]');
    const handle0 = dragTiles[0].querySelector<HTMLElement>('[data-slot="tile-drag-handle"]')!;
    fireEvent.pointerDown(handle0, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(dragTiles[1], { pointerId: 1, clientX: 100, clientY: 10 });
    fireEvent.pointerUp(dragTiles[1], { pointerId: 1, clientX: 100, clientY: 10 });
    expect(mounted.controller.value()[0]?.url).toBe('https://cdn.example.com/2.webp');

    const singleHost = document.createElement('div');
    document.body.appendChild(singleHost);
    const singleMounted = mountSingleImageUpload(singleHost, { value: first, aspectRatio: '4:5', locale: 'ar' });
    expect(singleMounted.element.dir).toBe('rtl');
    expect(singleHost.querySelector('[data-slot="dropzone"]')).toHaveAttribute('data-state', 'ready');

    mounted.destroy();
    singleMounted.destroy();
    host.remove();
    singleHost.remove();
  });
});
