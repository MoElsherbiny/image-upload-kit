import { act, fireEvent, render } from '@testing-library/react';
import { mount } from '@vue/test-utils';
import React from 'react';
import { defineComponent, h, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedImage as ReactAnimatedImage } from '../../src/react';
import type { UploadedImageData } from '../../src/types';
import {
  AnimatedImage, createImageUpload, HeadlessSingleUpload, IMAGE_UPLOAD_CONFIG_KEY,
  MultiImageUpload, provideImageUpload, provideImageUploadConfig, resetImageUploadConfig,
  SingleImageUpload, useImageUploadConfig, useMultiUpload, useSingleUpload,
} from '../../src/vue';
import { installMockXhr } from '../helpers/mockXhr';

const SAMPLE_LQIP =
  'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

function makeUploaded(overrides: Partial<UploadedImageData> = {}): UploadedImageData {
  return {
    url: 'https://cdn.example.com/item.webp', blurDataUrl: SAMPLE_LQIP, blurColor: '#3B82F6',
    altText: 'Product photo', width: 1200, height: 1500, format: 'webp', size: 42000,
    originalSize: 120000, contentHash: 'hash-1', uploadedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('img-upload-kit/vue — Plugin, Composables, Components & DOM Parity', () => {
  afterEach(() => {
    resetImageUploadConfig();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('supports createImageUpload plugin, provideImageUpload alias, provideImageUploadConfig, and useImageUploadConfig', () => {
    expect(typeof IMAGE_UPLOAD_CONFIG_KEY).toBe('symbol');
    expect(provideImageUpload).toBe(provideImageUploadConfig);

    const provided = provideImageUpload({
      endpoint: '/api/vue-upload', defaultPreset: 'square',
      locale: 'ar', headers: { 'x-tenant': 'acme' },
    });
    expect(provided.endpoint).toBe('/api/vue-upload');

    const resolved = useImageUploadConfig({ endpoint: '/api/override' });
    expect(resolved.endpoint).toBe('/api/override');
    expect(resolved.defaultPreset).toBe('square');
    expect(resolved.locale).toBe('ar');
    expect(resolved.headers).toEqual({ 'x-tenant': 'acme' });

    let injectedEndpoint = '';
    const Consumer = defineComponent({
      setup() {
        const cfg = useImageUploadConfig();
        injectedEndpoint = cfg.endpoint ?? '';
        return () => h('div', cfg.endpoint);
      },
    });
    const wrapper = mount(Consumer, {
      global: { plugins: [[createImageUpload({ endpoint: '/api/plugin-endpoint' })]] },
    });
    expect(injectedEndpoint).toBe('/api/plugin-endpoint');
    wrapper.unmount();
  });

  it('useSingleUpload handles MockXHR upload, transformAsset, cancel, clear with deleteEndpoint, and requireAltText / canSave', async () => {
    const xhr = installMockXhr();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ deleted: true }), { status: 200 }));

    try {
      const transformedEvents: string[] = [];
      const ctrl = useSingleUpload({
        endpoint: '/api/single', deleteEndpoint: '/api/single',
        preset: 'square', requireAltText: true,
        transformAsset: async (file, ctx) => {
          transformedEvents.push(`${file.name}:${ctx.preset}:${ctx.index}`);
          return new File(['transformed-bytes'], 'cropped.webp', { type: 'image/webp' });
        },
      });

      const rawFile = new File(['raw-bytes'], 'raw.png', { type: 'image/png' });
      const firstPromise = ctrl.selectFile(rawFile);
      await vi.waitFor(() => expect(xhr.pending()).toHaveLength(1));
      expect(ctrl.isUploading.value).toBe(true);
      ctrl.cancel();
      expect(await firstPromise).toBeNull();
      expect(ctrl.isUploading.value).toBe(false);

      const secondPromise = ctrl.selectFile(rawFile);
      await vi.waitFor(() => expect(xhr.pending()).toHaveLength(1));
      const req = xhr.latest();
      req.progress(60, 100);
      expect(ctrl.progress.value).toBeGreaterThan(0);

      req.respond(200, makeUploaded({ url: 'https://cdn.example.com/final.avif', altText: '' }));
      const uploaded = await secondPromise;
      expect(uploaded?.url).toBe('https://cdn.example.com/final.avif');
      expect(transformedEvents).toContain('raw.png:square:0');

      expect(ctrl.missingAltText.value).toBe(true);
      expect(ctrl.canSave.value).toBe(false);
      ctrl.setAltText('Accessible description');
      expect(ctrl.missingAltText.value).toBe(false);
      expect(ctrl.canSave.value).toBe(true);

      await ctrl.clear();
      expect(ctrl.value.value).toBeNull();
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/single?url=https%3A%2F%2Fcdn.example.com%2Ffinal.avif',
        expect.objectContaining({ method: 'DELETE' }),
      );
      ctrl.destroy();
    } finally {
      xhr.restore();
    }
  });

  it('useMultiUpload supports addFiles, move, setCover, onReorder, setItemAltText, retryFailed, and Arabic RTL announcements', async () => {
    const imgA = makeUploaded({ url: 'https://cdn.example.com/a.webp', contentHash: 'a' });
    const imgB = makeUploaded({ url: 'https://cdn.example.com/b.webp', contentHash: 'b' });

    const reorders: Array<{ urls: string[]; fromIndex: number; toIndex: number }> = [];
    let shouldFail = true;
    const ctrl = useMultiUpload({
      value: [imgA, imgB], locale: 'ar', requireAltText: true,
      customUploader: async (file) => {
        if (shouldFail && file.name === 'fail.webp') throw new Error('Temporary network failure');
        return makeUploaded({ url: `https://cdn.example.com/${file.name}`, contentHash: file.name, altText: '' });
      },
      onReorder: (images, detail) => {
        reorders.push({ urls: images.map((i) => i.url), fromIndex: detail.fromIndex, toIndex: detail.toIndex });
      },
    });

    expect(ctrl.coverBadgeLabel).toBe('غلاف');
    await ctrl.addFiles([new File(['x'], 'fail.webp', { type: 'image/webp' })]);
    expect(ctrl.state.value).toBe('error');

    shouldFail = false;
    await ctrl.retryFailed();
    expect(ctrl.value.value.map((i) => i.url)).toEqual([
      'https://cdn.example.com/a.webp',
      'https://cdn.example.com/b.webp',
      'https://cdn.example.com/fail.webp',
    ]);
    expect(ctrl.items.value[2].file).toBeUndefined();
    expect(ctrl.missingAltCount.value).toBe(1);
    expect(ctrl.canSave.value).toBe(false);

    ctrl.setItemAltText(ctrl.items.value[2].id, 'صورة المنتج');
    expect(ctrl.missingAltCount.value).toBe(0);
    expect(ctrl.canSave.value).toBe(true);

    ctrl.move(0, 2);
    expect(ctrl.liveAnnouncement.value).toContain('3');
    ctrl.setCover(2);
    expect(ctrl.value.value[0]?.url).toBe('https://cdn.example.com/a.webp');
    expect(reorders).toHaveLength(2);
    ctrl.destroy();
  });

  it('assigns distinct item IDs for duplicate contentHash images, preserves in-flight uploads across v-model updates, and reacts to prop changes', async () => {
    const dup1 = makeUploaded({ url: 'https://cdn.example.com/dup.webp', contentHash: 'same-hash', deduplicated: true });
    const dup2 = makeUploaded({ url: 'https://cdn.example.com/dup.webp', contentHash: 'same-hash', deduplicated: true });

    let resolveUpload!: (val: UploadedImageData) => void;
    let seenPreset = '';
    const wrapper = mount(MultiImageUpload, {
      props: {
        modelValue: [dup1, dup2],
        preset: 'card',
        customUploader: (_file, params) => {
          seenPreset = params.preset ?? '';
          return new Promise<UploadedImageData>((res) => { resolveUpload = res; });
        },
      },
    });
    const ctrl = (wrapper.vm as unknown as { controller: ReturnType<typeof useMultiUpload> }).controller;

    expect(ctrl.items.value).toHaveLength(2);
    expect(ctrl.items.value[0].id).not.toBe(ctrl.items.value[1].id);

    await ctrl.removeItem(ctrl.items.value[0].id);
    expect(ctrl.items.value).toHaveLength(1);

    await wrapper.setProps({ preset: 'square' });
    const addPromise = ctrl.addFiles([new File(['new'], 'inflight.webp', { type: 'image/webp' })]);
    await vi.waitFor(() => expect(seenPreset).toBe('square'));
    expect(ctrl.isUploading.value).toBe(true);
    expect(ctrl.items.value).toHaveLength(2);

    await wrapper.setProps({ modelValue: [{ ...dup2 }] });
    ctrl.setValue([{ ...dup2 }]);
    expect(ctrl.isUploading.value).toBe(true);
    expect(ctrl.items.value).toHaveLength(2);

    resolveUpload(makeUploaded({ url: 'https://cdn.example.com/inflight.webp', contentHash: 'h-new' }));
    await addPromise;
    expect(ctrl.isUploading.value).toBe(false);
    expect(ctrl.value.value).toHaveLength(2);
    wrapper.unmount();
  });

  it('maintains 100% DOM parity between React <AnimatedImage /> and Vue <AnimatedImage /> (including contain persistent blur)', async () => {
    vi.useFakeTimers();
    const sharedProps = {
      src: 'https://cdn.example.com/lookbook.webp', alt: 'Lookbook',
      blurDataUrl: SAMPLE_LQIP, blurColor: '#344040', objectFit: 'contain' as const, aspectRatio: '4:5' as const,
    };
    const { container: reactContainer } = render(React.createElement(ReactAnimatedImage, sharedProps));
    const vueWrapper = mount(AnimatedImage, { props: sharedProps });

    const reactWrap = reactContainer.querySelector<HTMLElement>('[data-slot="animated-image"]')!;
    const vueWrap = vueWrapper.element as HTMLElement;

    expect(vueWrap.className).toBe(reactWrap.className);
    expect(vueWrap.getAttribute('data-state')).toBe(reactWrap.getAttribute('data-state'));
    expect(vueWrap.style.aspectRatio).toBe(reactWrap.style.aspectRatio);
    expect(vueWrap.style.getPropertyValue('--iuk-animated-image-duration')).toBe(
      reactWrap.style.getPropertyValue('--iuk-animated-image-duration'),
    );
    expect(vueWrap.style.getPropertyValue('--iuk-ai-ph-dur')).toBe(
      reactWrap.style.getPropertyValue('--iuk-ai-ph-dur'),
    );

    const reactMainImg = reactWrap.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    const vueMainImg = vueWrap.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    reactMainImg.decode = vi.fn(() => Promise.resolve());
    vueMainImg.decode = vi.fn(() => Promise.resolve());

    await act(async () => { fireEvent.load(reactMainImg); fireEvent.load(vueMainImg); });
    await nextTick();
    act(() => { vi.advanceTimersByTime(1000); });
    await nextTick();

    expect(vueWrap.getAttribute('data-state')).toBe('loaded');
    expect(reactWrap.getAttribute('data-state')).toBe('loaded');

    const reactPh = reactWrap.querySelector<HTMLImageElement>('[data-slot="animated-image-placeholder"]')!;
    const vuePh = vueWrap.querySelector<HTMLImageElement>('[data-slot="animated-image-placeholder"]')!;
    expect(vuePh.className).toBe(reactPh.className);
    expect(vuePh.style.objectFit).toBe('cover');
    expect(vuePh).not.toHaveClass('iuk-animated-image__placeholder--hidden');
    vueWrapper.unmount();
  });

  it('mounts SingleImageUpload, MultiImageUpload, and HeadlessSingleUpload with v-model, cover badge, keyboard Alt+ArrowRight, and pointer reorder', async () => {
    const first = makeUploaded({ url: 'https://cdn.example.com/1.webp', contentHash: '1' });
    const second = makeUploaded({ url: 'https://cdn.example.com/2.webp', contentHash: '2' });

    const multiWrapper = mount(MultiImageUpload, {
      attachTo: document.body,
      props: { modelValue: [first, second], aspectRatio: '1:1', reorderable: true, showCoverBadge: true },
    });

    const tiles = multiWrapper.findAll('[data-slot="tile"]');
    expect(tiles).toHaveLength(2);
    expect((tiles[0].element as HTMLElement).style.aspectRatio).toBe('1 / 1');
    expect(tiles[0].find('[data-slot="cover-badge"]').text()).toBe('Cover');

    await tiles[1].find('[data-slot="tile-set-cover"]').trigger('click');
    const emittedAfterCover = multiWrapper.emitted('update:modelValue')?.at(-1)?.[0] as UploadedImageData[];
    expect(emittedAfterCover[0]?.url).toBe('https://cdn.example.com/2.webp');

    const updatedTiles = multiWrapper.findAll('[data-slot="tile"]');
    await updatedTiles[0].trigger('keydown', { key: 'ArrowRight', altKey: true });
    const emittedAfterKey = multiWrapper.emitted('update:modelValue')?.at(-1)?.[0] as UploadedImageData[];
    expect(emittedAfterKey[0]?.url).toBe('https://cdn.example.com/1.webp');

    const handle0 = multiWrapper.findAll('[data-slot="tile-drag-handle"]')[0].element as HTMLElement;
    const tile1El = multiWrapper.findAll('[data-slot="tile"]')[1].element as HTMLElement;
    fireEvent.pointerDown(handle0, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(tile1El, { pointerId: 1, clientX: 120, clientY: 10 });
    fireEvent.pointerUp(tile1El, { pointerId: 1, clientX: 120, clientY: 10 });
    await nextTick();
    const emittedAfterPointer = multiWrapper.emitted('update:modelValue')?.at(-1)?.[0] as UploadedImageData[];
    expect(emittedAfterPointer[0]?.url).toBe('https://cdn.example.com/2.webp');

    const singleWrapper = mount(SingleImageUpload, { props: { modelValue: first, aspectRatio: '4:5', locale: 'ar' } });
    expect(singleWrapper.attributes('dir')).toBe('rtl');
    expect(singleWrapper.find('[data-slot="dropzone"]').attributes('data-state')).toBe('ready');

    const headlessWrapper = mount(HeadlessSingleUpload, {
      props: { modelValue: first },
      slots: { default: (ctrl: { state: { value: string } }) => h('span', { 'data-slot': 'headless-state' }, ctrl.state.value) },
    });
    expect(headlessWrapper.find('[data-slot="headless-state"]').text()).toBe('ready');

    multiWrapper.unmount();
    singleWrapper.unmount();
    headlessWrapper.unmount();
  });
});
