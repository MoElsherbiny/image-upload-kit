import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { mount } from '@vue/test-utils';
import { useState } from 'react';
import { defineComponent, h, ref as vueRef } from 'vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMultiUpload, createSingleUpload, provideImageUploadConfig,
  resetImageUploadConfig as resetAngularConfig, withAngularSignals,
} from '../../src/angular';
import {
  AnimatedImage, ImageUploadProvider,
  MultiImageUpload as ReactMultiUpload, SingleImageUpload as ReactSingleUpload,
} from '../../src/react';
import { useMultiUpload as useHeadlessMulti, useSingleUpload as useHeadlessSingle } from '../../src/react/headless';
import {
  createExpoImagePickerAdapter, NativeImageUploadProvider, useNativeSingleUpload,
} from '../../src/react-native';
import type { UploadedImageData } from '../../src/types';
import {
  createImageUpload as createVueImageUpload, resetImageUploadConfig as resetVueConfig,
  SingleImageUpload as VueSingleUpload,
} from '../../src/vue';
import { solidImage, toFile } from '../helpers/imageFixtures';
import { installFetchBackedXhr, type LiveTestServer, startLiveTestServer } from '../helpers/liveTestServer';
import { installNodeWebGlobals } from '../helpers/nodeWebGlobals';
import { createMockExpoImagePicker } from '../helpers/reactNativeStub';

function createMockNgSignal<T>(initial: T) {
  let current = initial;
  const sig = (() => current) as (() => T) & { set: (v: T) => void; asReadonly: () => () => T };
  sig.set = (v: T) => { current = v; };
  sig.asReadonly = () => () => current;
  return sig;
}

describe('Full-Stack Framework E2E Uploads (jsdom -> Live HTTP -> Sharp -> LocalFS)', { timeout: 20_000 }, () => {
  let server: LiveTestServer;
  let xhrBridge: { restore(): void };
  let pngBlue: Buffer;
  let pngCoral: Buffer;
  let webGlobals: { restore(): void } | undefined;

  beforeAll(async () => {
    webGlobals = await installNodeWebGlobals();
    [pngBlue, pngCoral] = await Promise.all([
      solidImage(480, 360, 'png', '#2563eb'),
      solidImage(480, 360, 'png', '#e11d48'),
    ]);
    server = await startLiveTestServer();
  });

  afterAll(async () => { await server?.close(); webGlobals?.restore(); });
  beforeEach(() => { xhrBridge = installFetchBackedXhr(); });
  afterEach(() => { xhrBridge.restore(); resetVueConfig(); resetAngularConfig(); });

  it('1. React (img-upload-kit/react): uploads real PNG via <SingleImageUpload> & <MultiImageUpload>, renders <AnimatedImage>, and deletes on disk', async () => {
    let latestSingle: UploadedImageData | null = null;
    let latestGallery: UploadedImageData[] = [];

    function ReactHarness() {
      const [single, setSingle] = useState<UploadedImageData | null>(null);
      const [gallery, setGallery] = useState<UploadedImageData[]>([]);
      latestSingle = single;
      latestGallery = gallery;
      return (
        <ImageUploadProvider endpoint={server.uploadUrl} deleteEndpoint={server.uploadUrl}>
          <ReactSingleUpload value={single} onChange={setSingle} preset="card" showQualitySelector={false} />
          {single && <AnimatedImage image={single} />}
          <ReactMultiUpload
            mode="multiple" value={gallery} onChange={setGallery} preset="card"
            reorderable showCoverBadge showQualitySelector={false}
          />
        </ImageUploadProvider>
      );
    }

    const { container } = render(<ReactHarness />);
    const singleInput = container.querySelector<HTMLInputElement>('[data-slot="single-root"] input[type="file"]')!;
    await act(async () => {
      fireEvent.change(singleInput, { target: { files: [toFile(pngBlue, 'react-e2e.png', 'image/png')] } });
    });

    await waitFor(() => expect(latestSingle).not.toBeNull());
    const uploaded = latestSingle!;
    expect(['avif', 'webp']).toContain(uploaded.format);
    expect([uploaded.width, uploaded.height]).toEqual([480, 360]);
    expect(uploaded.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(uploaded.blurColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(await server.localFs.exists('media', uploaded.storagePath!)).toBe(true);

    const animWrap = container.querySelector<HTMLElement>('[data-slot="animated-image"]')!;
    expect(animWrap).toBeInTheDocument();
    expect(animWrap.querySelector('[data-slot="animated-image-placeholder"]')).toHaveAttribute('src', uploaded.blurDataUrl);

    const multiInput = container.querySelector<HTMLInputElement>('[data-slot="multi-root"] input[type="file"]')!;
    await act(async () => {
      fireEvent.change(multiInput, {
        target: { files: [toFile(pngBlue, 'g1.png', 'image/png'), toFile(pngCoral, 'g2.png', 'image/png')] },
      });
    });
    await waitFor(() => expect(latestGallery).toHaveLength(2));
    expect(container.querySelector('[data-slot="cover-badge"]')).toBeInTheDocument();

    const singlePath = uploaded.storagePath!;
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-slot="single-root"] [data-slot="tile-remove-btn"]')!);
    await waitFor(() => expect(latestSingle).toBeNull());
    await waitFor(async () => expect(await server.localFs.exists('media', singlePath)).toBe(false));
  });

  it('2. Headless React (img-upload-kit/headless): drives useSingleUpload & useMultiUpload (move, setCover, delete) over live HTTP', async () => {
    let singleCtrl!: ReturnType<typeof useHeadlessSingle>;
    let multiCtrl!: ReturnType<typeof useHeadlessMulti>;
    let galleryState: UploadedImageData[] = [];

    function HeadlessHarness() {
      const [singleVal, setSingleVal] = useState<UploadedImageData | null>(null);
      const [multiVal, setMultiVal] = useState<UploadedImageData[]>([]);
      galleryState = multiVal;
      singleCtrl = useHeadlessSingle({ value: singleVal, onChange: setSingleVal, preset: 'card' });
      multiCtrl = useHeadlessMulti({ value: multiVal, onChange: setMultiVal, preset: 'card' });
      return (
        <div>
          <input data-testid="hl-single" {...singleCtrl.getInputProps()} />
          <input data-testid="hl-multi" {...multiCtrl.getInputProps()} />
        </div>
      );
    }

    const { getByTestId } = render(
      <ImageUploadProvider endpoint={server.uploadUrl} deleteEndpoint={server.uploadUrl}>
        <HeadlessHarness />
      </ImageUploadProvider>,
    );

    fireEvent.change(getByTestId('hl-single'), { target: { files: [toFile(pngBlue, 'hl-single.png', 'image/png')] } });
    await waitFor(() => expect(singleCtrl.uploadedData).not.toBeNull());
    const singlePath = singleCtrl.uploadedData!.storagePath!;
    expect(await server.localFs.exists('media', singlePath)).toBe(true);

    act(() => singleCtrl.remove());
    await waitFor(async () => expect(await server.localFs.exists('media', singlePath)).toBe(false));

    fireEvent.change(getByTestId('hl-multi'), {
      target: { files: [toFile(pngBlue, 'hl-1.png', 'image/png'), toFile(pngCoral, 'hl-2.png', 'image/png')] },
    });
    await waitFor(() => expect(galleryState).toHaveLength(2));
    const [firstUrl, secondUrl] = [galleryState[0]!.url, galleryState[1]!.url];

    act(() => multiCtrl.move(0, 1));
    await waitFor(() => expect(galleryState[0]?.url).toBe(secondUrl));

    act(() => multiCtrl.setCover(1));
    await waitFor(() => expect(galleryState[0]?.url).toBe(firstUrl));

    const removedPath = galleryState[0]!.storagePath!;
    act(() => multiCtrl.remove(multiCtrl.items[0]!.id));
    await waitFor(async () => expect(await server.localFs.exists('media', removedPath)).toBe(false));
  });

  it('3. Vue 3 (img-upload-kit/vue): mounts <SingleImageUpload> with createImageUpload plugin, updates v-model from Sharp, and deletes', async () => {
    const model = vueRef<UploadedImageData | null>(null);
    const Host = defineComponent({
      setup() {
        return () => h(VueSingleUpload, {
          modelValue: model.value,
          'onUpdate:modelValue': (val: UploadedImageData | null) => { model.value = val; },
          preset: 'card',
        });
      },
    });

    const wrapper = mount(Host, {
      global: { plugins: [[createVueImageUpload({ endpoint: server.uploadUrl, deleteEndpoint: server.uploadUrl })]] },
    });

    const input = wrapper.find('input[type="file"]').element as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [toFile(pngCoral, 'vue-live.png', 'image/png')], configurable: true });
    await wrapper.find('input[type="file"]').trigger('change');

    await waitFor(() => expect(model.value).not.toBeNull());
    const data = model.value!;
    expect(['avif', 'webp']).toContain(data.format);
    expect([data.width, data.height]).toEqual([480, 360]);
    expect(data.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(await server.localFs.exists('media', data.storagePath!)).toBe(true);

    const savedPath = data.storagePath!;
    await wrapper.find('[data-slot="tile-remove-btn"]').trigger('click');
    await waitFor(() => expect(model.value).toBeNull());
    await waitFor(async () => expect(await server.localFs.exists('media', savedPath)).toBe(false));
    wrapper.unmount();
  });

  it('4. Angular (img-upload-kit/angular): bridges createSingleUpload & createMultiUpload via withAngularSignals over live HTTP', async () => {
    provideImageUploadConfig({ endpoint: server.uploadUrl, deleteEndpoint: server.uploadUrl });

    const single = withAngularSignals(createSingleUpload({ preset: 'card' }), { signal: createMockNgSignal });
    const progressObserved: number[] = [];
    const unsub = single.progress.subscribe((pct) => progressObserved.push(pct));

    const uploadPromise = single.selectFile(toFile(pngBlue, 'ng-single.png', 'image/png'));
    expect(single.isUploading()).toBe(true);
    const singleData = await uploadPromise;
    unsub();

    expect(single.isUploading()).toBe(false);
    expect(progressObserved.some((p) => p > 0)).toBe(true);
    expect(single.value()?.url).toBe(singleData?.url);
    expect(singleData?.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(await server.localFs.exists('media', singleData!.storagePath!)).toBe(true);

    const singlePath = singleData!.storagePath!;
    await single.clear();
    expect(single.value()).toBeNull();
    expect(await server.localFs.exists('media', singlePath)).toBe(false);

    const multi = withAngularSignals(createMultiUpload({ preset: 'card' }), { signal: createMockNgSignal });
    await multi.addFiles([toFile(pngBlue, 'ng-1.png', 'image/png'), toFile(pngCoral, 'ng-2.png', 'image/png')]);
    expect(multi.items()).toHaveLength(2);
    const secondUrl = multi.value()[1]!.url;

    multi.setCover(1);
    expect(multi.value()[0]?.url).toBe(secondUrl);

    const coverPath = multi.value()[0]!.storagePath!;
    await multi.removeItem(multi.items()[0]!.id);
    expect(await server.localFs.exists('media', coverPath)).toBe(false);

    single.destroy();
    multi.destroy();
  });

  it('5. React Native / Expo (img-upload-kit/react-native): picks data:image/png URI via Expo adapter and uploads NativeUploadAsset to live server', async () => {
    const dataUri = `data:image/png;base64,${pngBlue.toString('base64')}`;
    const expoPicker = createExpoImagePickerAdapter(
      createMockExpoImagePicker({
        assets: [{
          uri: dataUri, fileName: 'expo-picked.png', mimeType: 'image/png',
          fileSize: pngBlue.byteLength, width: 480, height: 360,
        }],
      }),
    );

    const { result } = renderHook(
      () => useNativeSingleUpload({ preset: 'card', deleteEndpoint: server.uploadUrl }),
      {
        wrapper: ({ children }) => (
          <NativeImageUploadProvider endpoint={server.uploadUrl} deleteEndpoint={server.uploadUrl} picker={expoPicker}>
            {children}
          </NativeImageUploadProvider>
        ),
      },
    );

    let uploaded: UploadedImageData | null = null;
    await act(async () => { uploaded = await result.current.pickFromLibrary(); });

    expect(uploaded).not.toBeNull();
    expect(result.current.image?.url).toBe(uploaded!.url);
    expect(['avif', 'webp']).toContain(uploaded!.format);
    expect([uploaded!.width, uploaded!.height]).toEqual([480, 360]);
    expect(uploaded!.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(await server.localFs.exists('media', uploaded!.storagePath!)).toBe(true);

    const rnPath = uploaded!.storagePath!;
    await act(async () => { await result.current.clear(); });
    expect(result.current.image).toBeNull();
    expect(await server.localFs.exists('media', rnPath)).toBe(false);

    // Also verify fetch fallback (no global XMLHttpRequest) with presigned mode on /api/upload
    xhrBridge.restore();
    const scope = globalThis as { XMLHttpRequest?: unknown };
    const savedXhr = scope.XMLHttpRequest;
    delete scope.XMLHttpRequest;
    try {
      const { result: fetchHook } = renderHook(
        () => useNativeSingleUpload({ preset: 'card', uploadMode: 'presigned' }),
        { wrapper: ({ children }) => <NativeImageUploadProvider endpoint={server.uploadUrl} picker={expoPicker}>{children}</NativeImageUploadProvider> },
      );
      await act(async () => { await fetchHook.current.pickFromLibrary(); });
      expect(fetchHook.current.image?.storagePath).toBeTruthy();
      expect(await server.localFs.exists('media', fetchHook.current.image!.storagePath!)).toBe(true);
    } finally {
      if (savedXhr !== undefined) scope.XMLHttpRequest = savedXhr;
    }
  });
});
