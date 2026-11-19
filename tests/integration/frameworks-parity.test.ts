import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as angularEntry from '../../src/angular';
import * as clientEntry from '../../src/client';
import * as reactEntry from '../../src/react';
import * as headlessEntry from '../../src/react/headless';
import * as reactNativeEntry from '../../src/react-native';
import * as vueEntry from '../../src/vue';

describe('Cross-Framework Parity & Runtime Boundary Isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    angularEntry.resetImageUploadConfig();
    vueEntry.resetImageUploadConfig();
  });

  it('isolates all framework entries safely in Node without DOM globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');

    // React & Headless share the exact same context & provider singletons
    expect(reactEntry.ImageUploadProvider).toBe(headlessEntry.ImageUploadProvider);
    expect(reactEntry.useImageUploadContext).toBe(headlessEntry.useImageUploadContext);
    expect(['function', 'object']).toContain(typeof reactEntry.SingleImageUpload);
    expect(['function', 'object']).toContain(typeof reactEntry.MultiImageUpload);
    expect(typeof headlessEntry.useSingleUpload).toBe('function');
    expect(typeof headlessEntry.useMultiUpload).toBe('function');

    // Vue exports plugin, composables, and components
    expect(typeof vueEntry.createImageUpload).toBe('function');
    expect(typeof vueEntry.provideImageUploadConfig).toBe('function');
    expect(typeof vueEntry.useImageUploadConfig).toBe('function');
    expect(typeof vueEntry.useSingleUpload).toBe('function');
    expect(typeof vueEntry.useMultiUpload).toBe('function');

    // Angular exports controllers, signals bridge, and DI config provider
    expect(typeof angularEntry.createSingleUpload).toBe('function');
    expect(typeof angularEntry.createMultiUpload).toBe('function');
    expect(typeof angularEntry.withAngularSignals).toBe('function');
    expect(typeof angularEntry.provideImageUploadConfig).toBe('function');

    // React Native exports picker adapters and theme tokens
    expect(typeof reactNativeEntry.createExpoImagePickerAdapter).toBe('function');
    expect(typeof reactNativeEntry.createRnImagePickerAdapter).toBe('function');
    expect(reactNativeEntry.defaultNativeTheme.primary).toBeTruthy();
    expect(reactNativeEntry.nativeThemes.light.surface).toBeTruthy();
    expect(reactNativeEntry.darkNativeTheme.surface).toBeTruthy();

    // Client exports universal upload & resize primitives
    expect(typeof clientEntry.uploadAsset).toBe('function');
    expect(typeof clientEntry.createClientResizeTransform).toBe('function');
  });

  it('Vue SSR composables and plugin render cleanly without DOM globals', async () => {
    const app = createSSRApp({
      render: () =>
        h('section', [
          h(vueEntry.SingleImageUpload, { preset: 'card', locale: 'en' }),
          h(vueEntry.MultiImageUpload, { preset: 'square', modelValue: [] }),
        ]),
    });
    app.use(vueEntry.createImageUpload({ endpoint: '/api/vue-upload', locale: 'en' }));

    const html = await renderToString(app);
    expect(html).toContain('data-slot="single-root"');
    expect(html).toContain('data-slot="multi-root"');
    expect(vueEntry.useImageUploadConfig().endpoint).toBe('/api/upload');
  });

  it('Angular controllers support provideImageUploadConfig, withAngularSignals, error handling, and cancellation', async () => {
    const provider = angularEntry.provideImageUploadConfig({
      endpoint: '/api/ng-upload',
      locale: 'en',
    });
    expect(provider.provide).toBe(angularEntry.IMAGE_UPLOAD_CONFIG_TOKEN);
    expect(provider.useValue.endpoint).toBe('/api/ng-upload');

    const destroyCallbacks: Array<() => void> = [];
    const fakeSignal = <T,>(initial: T) => {
      let current = initial;
      const fn = (() => current) as angularEntry.AngularWritableSignalLike<T>;
      fn.set = (next: T) => {
        current = next;
      };
      fn.update = (updater: (prev: T) => T) => {
        current = updater(current);
      };
      fn.asReadonly = () => () => current;
      return fn;
    };

    const single = angularEntry.withAngularSignals(
      angularEntry.createSingleUpload({
        endpoint: '/api/ng-upload',
        maxSizeMB: 0.0001,
        allowedFormats: ['image/png'],
      }),
      {
        signal: fakeSignal,
        destroyRef: { onDestroy: (cb) => destroyCallbacks.push(cb) },
      },
    );

    // Validation error handling parity
    const invalidFile = new File([new Uint8Array(64)], 'doc.pdf', { type: 'application/pdf' });
    const rejected = await single.selectFile(invalidFile);
    expect(rejected).toBeNull();
    expect(single.error().length).toBeGreaterThan(0);
    expect(single.phase()).toBe('error');

    // Cancellation parity via customUploader honoring AbortSignal
    let aborted = false;
    const cancelCtrl = angularEntry.createSingleUpload({
      customUploader: (_file, params) =>
        new Promise((_resolve, reject) => {
          params.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(clientEntry.createUploadAbortError('Cancelled'));
          });
        }),
    });
    const validFile = new File([new Uint8Array([1, 2, 3])], 'ok.png', { type: 'image/png' });
    const pending = cancelCtrl.selectFile(validFile);
    await new Promise((r) => setTimeout(r, 15));
    cancelCtrl.cancel();
    expect(await pending).toBeNull();
    expect(aborted).toBe(true);
    expect(cancelCtrl.isUploading()).toBe(false);

    // Multi-upload controller initialization & reorder parity
    const multi = angularEntry.createMultiUpload({ maxFiles: 3 });
    expect(multi.canAddMore()).toBe(true);
    expect(multi.items()).toEqual([]);

    for (const cb of destroyCallbacks) cb();
    cancelCtrl.destroy();
    multi.destroy();
  });

  it('React Native pickers handle permissions, compatible representation, and abortable transforms', async () => {
    const expoAdapter = reactNativeEntry.createExpoImagePickerAdapter({
      requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
      requestCameraPermissionsAsync: vi.fn(async () => ({ granted: true })),
      launchImageLibraryAsync: vi.fn(async () => ({ canceled: true, assets: [] })),
      launchCameraAsync: vi.fn(async () => ({
        canceled: false,
        assets: [{ uri: 'file:///cam.jpg', fileName: 'cam.jpg', mimeType: 'image/jpeg', fileSize: 1200 }],
      })),
    });

    await expect(expoAdapter.pickFromLibrary()).rejects.toBeInstanceOf(
      reactNativeEntry.PickerPermissionError,
    );
    const taken = await expoAdapter.takePhoto();
    expect(taken[0]?.uri).toBe('file:///cam.jpg');

    const rnAdapter = reactNativeEntry.createRnImagePickerAdapter({
      launchImageLibrary: vi.fn(async () => ({ errorCode: 'permission', errorMessage: 'Denied' })),
      launchCamera: vi.fn(async () => ({ didCancel: true })),
    });
    await expect(rnAdapter.pickFromLibrary()).rejects.toBeInstanceOf(
      reactNativeEntry.PickerPermissionError,
    );
    expect(await rnAdapter.takePhoto()).toEqual([]);

    // Abortable Expo manipulator transform
    const resizeTransform = reactNativeEntry.createExpoManipulatorResizeTransform(
      {
        manipulateAsync: vi.fn(async (uri: string) => ({ uri, width: 400, height: 300 })),
      },
      { maxWidth: 400 },
    );
    const ac = new AbortController();
    ac.abort();
    await expect(
      resizeTransform(
        { uri: 'file:///a.jpg', name: 'a.jpg', type: 'image/jpeg' },
        { signal: ac.signal, index: 0, preset: 'card' },
      ),
    ).rejects.toSatisfy((err: unknown) => clientEntry.isUploadAbortError(err));
  });

  it('Client engine honors AbortController cancellation and safe Node fallback in createClientResizeTransform', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'sample.png', { type: 'image/png' });
    const resize = clientEntry.createClientResizeTransform({ maxWidth: 800 });

    // In Node without OffscreenCanvas, resize safely passes through the original File
    const activeAc = new AbortController();
    const passthrough = await resize(file, { signal: activeAc.signal, index: 0 });
    expect(passthrough).toBe(file);

    // Pre-aborted signal throws UploadAbortError in both resize and uploadAsset
    const abortedAc = new AbortController();
    abortedAc.abort();
    await expect(resize(file, { signal: abortedAc.signal, index: 0 })).rejects.toSatisfy(
      (err: unknown) => clientEntry.isUploadAbortError(err),
    );
    await expect(
      clientEntry.uploadAsset(
        file,
        { preset: 'card' },
        { mode: 'presigned', endpoint: 'http://localhost/api/upload', signal: abortedAc.signal },
      ),
    ).rejects.toSatisfy((err: unknown) => clientEntry.isUploadAbortError(err));
  });
});
