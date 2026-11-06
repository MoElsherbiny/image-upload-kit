import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createComputed, createMultiUpload, createSignal, createSingleUpload,
  IMAGE_UPLOAD_CONFIG_TOKEN, injectImageUploadConfig, mountAnimatedImage,
  mountMultiImageUpload, mountSingleImageUpload, provideImageUploadConfig,
  resetImageUploadConfig,
} from '../../src/angular';
import { AnimatedImage } from '../../src/react';
import type { UploadedImageData } from '../../src/types';
import { installMockXhr } from '../helpers/mockXhr';

const SAMPLE_LQIP =
  'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

function makeUploaded(overrides: Partial<UploadedImageData> = {}): UploadedImageData {
  return {
    url: 'https://cdn.example.com/item.webp',
    blurDataUrl: SAMPLE_LQIP,
    blurColor: '#3B82F6',
    altText: 'Product photo',
    width: 1200,
    height: 1500,
    format: 'webp',
    size: 42000,
    originalSize: 120000,
    contentHash: 'hash-1',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('img-upload-kit/angular — Signals, DI, Controllers & DOM Parity', () => {
  afterEach(() => {
    resetImageUploadConfig();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('supports createSignal, createComputed, provideImageUploadConfig, and injectImageUploadConfig', () => {
    const count = createSignal(2);
    const doubled = createComputed(() => count() * 2, [count]);
    const observed: number[] = [];
    const unsub = doubled.subscribe((v) => observed.push(v));

    count.update((n) => n + 3);
    expect(count()).toBe(5);
    expect(doubled()).toBe(10);
    expect(observed).toEqual([10]);
    unsub();

    const provider = provideImageUploadConfig({
      endpoint: '/api/angular-upload',
      defaultPreset: 'square',
      locale: 'ar',
      headers: { 'x-tenant': 'acme' },
    });
    expect(provider.provide).toBe(IMAGE_UPLOAD_CONFIG_TOKEN);
    expect(provider.useValue.endpoint).toBe('/api/angular-upload');

    const injected = injectImageUploadConfig({ endpoint: '/api/override' });
    expect(injected.endpoint).toBe('/api/override');
    expect(injected.defaultPreset).toBe('square');
    expect(injected.locale).toBe('ar');
    expect(injected.headers).toEqual({ 'x-tenant': 'acme' });
  });

  it('createSingleUpload handles ControlValueAccessor, MockXHR upload, cancel, and transformAsset', async () => {
    const xhr = installMockXhr();
    try {
      const transformedEvents: string[] = [];
      const ctrl = createSingleUpload({
        endpoint: '/api/single',
        preset: 'square',
        transformAsset: async (file, ctx) => {
          transformedEvents.push(`${file.name}:${ctx.preset}:${ctx.index}`);
          return new File(['transformed-bytes'], 'cropped.webp', { type: 'image/webp' });
        },
      });

      const cva = ctrl.toControlValueAccessor();
      const cvaChanges: Array<UploadedImageData | null> = [];
      cva.registerOnChange((val) => cvaChanges.push(val));

      const seeded = makeUploaded({ url: 'https://cdn.example.com/seeded.webp' });
      cva.writeValue(seeded);
      expect(ctrl.value()?.url).toBe('https://cdn.example.com/seeded.webp');
      expect(ctrl.state()).toBe('ready');
      expect(cvaChanges).toHaveLength(0);

      cva.setDisabledState?.(true);
      expect(ctrl.disabled()).toBe(true);
      expect(ctrl.state()).toBe('disabled');
      cva.setDisabledState?.(false);

      const rawFile = new File(['raw-bytes'], 'raw.png', { type: 'image/png' });
      const uploadPromise = ctrl.selectFile(rawFile);
      await vi.waitFor(() => expect(xhr.pending()).toHaveLength(1));
      expect(ctrl.isUploading()).toBe(true);
      ctrl.cancel();
      expect(await uploadPromise).toBeNull();
      expect(ctrl.isUploading()).toBe(false);

      const secondPromise = ctrl.selectFile(rawFile);
      await vi.waitFor(() => expect(xhr.pending()).toHaveLength(1));
      const req = xhr.latest();
      req.progress(50, 100);
      expect(ctrl.progress()).toBeGreaterThan(0);

      req.respond(200, makeUploaded({ url: 'https://cdn.example.com/final.avif' }));
      const result = await secondPromise;
      expect(result?.url).toBe('https://cdn.example.com/final.avif');
      expect(transformedEvents).toContain('raw.png:square:0');
      expect(cvaChanges.at(-1)?.url).toBe('https://cdn.example.com/final.avif');
      ctrl.destroy();
    } finally {
      xhr.restore();
    }
  });

  it('createMultiUpload supports addFiles, move(from, to), setCover(index), onReorder, and ControlValueAccessor', async () => {
    const imgA = makeUploaded({ url: 'https://cdn.example.com/a.webp', contentHash: 'a' });
    const imgB = makeUploaded({ url: 'https://cdn.example.com/b.webp', contentHash: 'b' });
    const imgC = makeUploaded({ url: 'https://cdn.example.com/c.webp', contentHash: 'c' });

    const reorders: Array<{ urls: string[]; fromIndex: number; toIndex: number }> = [];
    let counter = 0;
    const ctrl = createMultiUpload({
      value: [imgA, imgB],
      customUploader: async (file) => {
        counter += 1;
        return makeUploaded({ url: `https://cdn.example.com/${file.name}`, contentHash: `up-${counter}` });
      },
      onReorder: (images, detail) => {
        reorders.push({ urls: images.map((i) => i.url), fromIndex: detail.fromIndex, toIndex: detail.toIndex });
      },
    });

    const cva = ctrl.toControlValueAccessor();
    const cvaSnapshots: string[][] = [];
    cva.registerOnChange((list) => cvaSnapshots.push(list.map((i) => i.url)));

    await ctrl.addFiles([new File(['c'], 'c.webp', { type: 'image/webp' })]);
    expect(ctrl.value().map((i) => i.url)).toEqual([
      'https://cdn.example.com/a.webp',
      'https://cdn.example.com/b.webp',
      'https://cdn.example.com/c.webp',
    ]);

    ctrl.move(0, 2);
    expect(ctrl.value().map((i) => i.url)).toEqual([
      'https://cdn.example.com/b.webp',
      'https://cdn.example.com/c.webp',
      'https://cdn.example.com/a.webp',
    ]);

    ctrl.setCover(2);
    expect(ctrl.value()[0]?.url).toBe('https://cdn.example.com/a.webp');
    expect(reorders).toHaveLength(2);
    expect(reorders[1]).toEqual({
      urls: [
        'https://cdn.example.com/a.webp',
        'https://cdn.example.com/b.webp',
        'https://cdn.example.com/c.webp',
      ],
      fromIndex: 2,
      toIndex: 0,
    });

    cva.writeValue([imgC]);
    expect(ctrl.value().map((i) => i.url)).toEqual(['https://cdn.example.com/c.webp']);
    expect(cvaSnapshots.length).toBeGreaterThanOrEqual(3);
    ctrl.destroy();
  });

  it('maintains 100% DOM parity between React <AnimatedImage /> and Angular mountAnimatedImage (including contain persistent blur)', async () => {
    vi.useFakeTimers();

    const { container: reactContainer } = render(
      <AnimatedImage
        src="https://cdn.example.com/lookbook.webp"
        alt="Lookbook"
        blurDataUrl={SAMPLE_LQIP}
        blurColor="#344040"
        objectFit="contain"
        aspectRatio="4:5"
      />,
    );

    const ngHost = document.createElement('div');
    document.body.appendChild(ngHost);
    const ngMounted = mountAnimatedImage(ngHost, {
      src: 'https://cdn.example.com/lookbook.webp',
      alt: 'Lookbook',
      blurDataUrl: SAMPLE_LQIP,
      blurColor: '#344040',
      objectFit: 'contain',
      aspectRatio: '4:5',
    });

    const reactWrap = reactContainer.querySelector<HTMLElement>('[data-slot="animated-image"]')!;
    const ngWrap = ngHost.querySelector<HTMLElement>('[data-slot="animated-image"]')!;

    expect(ngWrap.className).toBe(reactWrap.className);
    expect(ngWrap.getAttribute('data-state')).toBe(reactWrap.getAttribute('data-state'));
    expect(ngWrap.style.aspectRatio).toBe(reactWrap.style.aspectRatio);
    expect(ngWrap.style.getPropertyValue('--iuk-animated-image-duration')).toBe(
      reactWrap.style.getPropertyValue('--iuk-animated-image-duration'),
    );
    expect(ngWrap.style.getPropertyValue('--iuk-ai-ph-dur')).toBe(
      reactWrap.style.getPropertyValue('--iuk-ai-ph-dur'),
    );

    const reactMainImg = reactWrap.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    const ngMainImg = ngWrap.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    reactMainImg.decode = vi.fn(() => Promise.resolve());
    ngMainImg.decode = vi.fn(() => Promise.resolve());

    await act(async () => {
      fireEvent.load(reactMainImg);
      fireEvent.load(ngMainImg);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(ngWrap.getAttribute('data-state')).toBe('loaded');
    expect(reactWrap.getAttribute('data-state')).toBe('loaded');

    const reactPh = reactWrap.querySelector<HTMLImageElement>('[data-slot="animated-image-placeholder"]')!;
    const ngPh = ngWrap.querySelector<HTMLImageElement>('[data-slot="animated-image-placeholder"]')!;
    expect(ngPh).toBeTruthy();
    expect(ngPh.className).toBe(reactPh.className);
    expect(ngPh.style.objectFit).toBe('cover');
    expect(ngPh).not.toHaveClass('iuk-animated-image__placeholder--hidden');

    ngMounted.destroy();
    ngHost.remove();
  });

  it('mounts MultiImageUpload & SingleImageUpload DOM elements with cover badge and reorder button interactions', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const first = makeUploaded({ url: 'https://cdn.example.com/1.webp', contentHash: '1' });
    const second = makeUploaded({ url: 'https://cdn.example.com/2.webp', contentHash: '2' });

    const mounted = mountMultiImageUpload(host, {
      value: [first, second], aspectRatio: '1:1', reorderable: true, showCoverBadge: true,
    });

    const tiles = host.querySelectorAll<HTMLElement>('[data-slot="tile"]');
    expect(tiles).toHaveLength(2);
    expect(tiles[0].style.aspectRatio).toBe('1 / 1');
    expect(tiles[0].querySelector('[data-slot="cover-badge"]')?.textContent).toBe('Cover');
    expect(tiles[1].querySelector('[data-slot="cover-badge"]')).toBeNull();

    fireEvent.click(tiles[1].querySelector<HTMLButtonElement>('[data-slot="tile-set-cover"]')!);
    expect(mounted.controller.value()[0]?.url).toBe('https://cdn.example.com/2.webp');

    const updatedTiles = host.querySelectorAll<HTMLElement>('[data-slot="tile"]');
    expect(updatedTiles[0].querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/2.webp');
    expect(updatedTiles[0].querySelector('[data-slot="cover-badge"]')?.textContent).toBe('Cover');

    fireEvent.click(updatedTiles[0].querySelector<HTMLButtonElement>('[data-slot="tile-move-later"]')!);
    expect(mounted.controller.value()[0]?.url).toBe('https://cdn.example.com/1.webp');

    const singleHost = document.createElement('div');
    document.body.appendChild(singleHost);
    const singleMounted = mountSingleImageUpload(singleHost, { value: first, aspectRatio: '4:5' });
    expect(singleHost.querySelector('[data-slot="dropzone"]')).toHaveAttribute('data-state', 'ready');

    mounted.destroy();
    singleMounted.destroy();
    host.remove();
    singleHost.remove();
  });
});
