import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnimatedImage,
  createExpoImagePickerAdapter,
  createRnImagePickerAdapter,
  MultiImageUpload,
  NativePressable,
  NativeText,
  PickerPermissionError,
  SingleImageUpload,
  useNativeMultiUpload,
  useNativeSingleUpload,
} from '../../src/react-native';
import { installMockXhr } from '../helpers/mockXhr';
import {
  createMockExpoImagePicker,
  createMockRnImagePicker,
  makeNativeAsset,
  makeUploadedImage,
  MockExpoImage,
  SAMPLE_LQIP,
} from '../helpers/reactNativeStub';

describe('React Native & Expo Subpath (img-upload-kit/react-native)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('createExpoImagePickerAdapter enforces preferredAssetRepresentationMode="compatible", maps multi-select, and throws PickerPermissionError', async () => {
    const expoMock = createMockExpoImagePicker({
      assets: [
        { uri: 'file:///expo/1.jpg', fileName: '1.jpg', mimeType: 'image/jpeg', fileSize: 50_000, width: 800, height: 800 },
        { uri: 'file:///expo/2.jpg', fileName: '2.jpg', mimeType: 'image/jpeg', fileSize: 60_000, width: 900, height: 900 },
      ],
    });
    const adapter = createExpoImagePickerAdapter(expoMock);
    const picked = await adapter.pickFromLibrary({ multiple: true, maxFiles: 5 });

    expect(expoMock.requestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(expoMock.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredAssetRepresentationMode: 'compatible',
        allowsMultipleSelection: true,
        selectionLimit: 5,
      }),
    );
    expect(picked).toHaveLength(2);
    expect(picked[0]).toEqual({
      uri: 'file:///expo/1.jpg',
      name: '1.jpg',
      type: 'image/jpeg',
      size: 50_000,
      width: 800,
      height: 800,
    });

    const deniedAdapter = createExpoImagePickerAdapter(
      createMockExpoImagePicker({ cameraGranted: false }),
    );
    await expect(deniedAdapter.takePhoto()).rejects.toBeInstanceOf(PickerPermissionError);
  });

  it('createRnImagePickerAdapter passes assetRepresentationMode="compatible" and throws PickerPermissionError', async () => {
    const rnMock = createMockRnImagePicker();
    const adapter = createRnImagePickerAdapter(rnMock);
    const picked = await adapter.pickFromLibrary({ multiple: false });

    expect(rnMock.launchImageLibrary).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'photo',
        assetRepresentationMode: 'compatible',
        selectionLimit: 1,
      }),
    );
    expect(picked).toHaveLength(1);
    expect(picked[0]?.uri).toBe('file:///rn/library/photo-1.jpg');

    const deniedAdapter = createRnImagePickerAdapter(
      createMockRnImagePicker({ errorCode: 'permission' }),
    );
    await expect(deniedAdapter.takePhoto()).rejects.toBeInstanceOf(PickerPermissionError);
  });

  it('useNativeSingleUpload handles optimistic preview, transformAsset, and HEIC rejection', async () => {
    const xhr = installMockXhr();
    try {
      const transformAsset = vi.fn(async (asset) => ({
        ...asset,
        uri: `${asset.uri}?cropped=1`,
      }));
      const { result } = renderHook(() =>
        useNativeSingleUpload({ endpoint: 'https://api.example.com/upload', transformAsset }),
      );

      let uploadPromise!: Promise<unknown>;
      await act(async () => {
        uploadPromise = result.current.uploadAsset(
          makeNativeAsset({ uri: 'file:///local/avatar.jpg' }),
        );
      });

      expect(result.current.previewUri).toBe('file:///local/avatar.jpg');
      expect(transformAsset).toHaveBeenCalledTimes(1);

      await act(async () => {
        xhr.latest().progress(40, 100);
        xhr.latest().respond(200, makeUploadedImage({ url: 'https://cdn.example.com/avatar.webp' }));
        await uploadPromise;
      });

      expect(result.current.image?.url).toBe('https://cdn.example.com/avatar.webp');
      expect(result.current.previewUri).toBe('https://cdn.example.com/avatar.webp');

      const { result: heicHook } = renderHook(() =>
        useNativeSingleUpload({ endpoint: 'https://api.example.com/upload' }),
      );
      await act(async () => {
        const res = await heicHook.current.uploadAsset(
          makeNativeAsset({ uri: 'file:///local/IMG_001.HEIC', name: 'IMG_001.HEIC', type: 'image/heic' }),
        );
        expect(res).toBeNull();
      });
      expect(heicHook.current.error).toMatch(/HEIC\/HEIF/i);
    } finally {
      xhr.restore();
    }
  });

  it('useNativeMultiUpload supports addAssets, optimistic preview, cancelItem, retryItem, move(from, to), and setCover(index)', async () => {
    const xhr = installMockXhr();
    try {
      const onReorder = vi.fn();
      const { result } = renderHook(() =>
        useNativeMultiUpload({
          endpoint: 'https://api.example.com/upload',
          maxParallelUploads: 3,
          onReorder,
        }),
      );

      let batchPromise!: Promise<unknown>;
      await act(async () => {
        batchPromise = result.current.addAssets([
          makeNativeAsset({ uri: 'file:///local/1.jpg', name: '1.jpg' }),
          makeNativeAsset({ uri: 'file:///local/2.jpg', name: '2.jpg' }),
          makeNativeAsset({ uri: 'file:///local/3.jpg', name: '3.jpg' }),
        ]);
      });

      expect(result.current.items).toHaveLength(3);
      expect(result.current.items[0]?.uri).toBe('file:///local/1.jpg');
      expect(result.current.items[0]?.isUploading).toBe(true);

      const thirdId = result.current.items[2]!.id;
      act(() => result.current.cancelItem(thirdId));
      expect(result.current.items).toHaveLength(2);

      const secondId = result.current.items[1]!.id;
      await act(async () => {
        xhr.instances[0]!.respond(200, makeUploadedImage({ url: 'https://cdn.example.com/1.webp' }));
        xhr.instances[1]!.respond(500, { error: 'Storage busy' });
        await batchPromise;
      });
      expect(result.current.items[1]?.error).toMatch(/Storage busy/);

      await act(async () => {
        const retryPromise = result.current.retryItem(secondId);
        await waitFor(() => expect(xhr.pending()).toHaveLength(1));
        xhr.latest().respond(200, makeUploadedImage({ url: 'https://cdn.example.com/2.webp' }));
        await retryPromise;
      });

      expect(result.current.images.map((i) => i.url)).toEqual([
        'https://cdn.example.com/1.webp',
        'https://cdn.example.com/2.webp',
      ]);

      act(() => result.current.setCover(1));
      expect(result.current.images.map((i) => i.url)).toEqual([
        'https://cdn.example.com/2.webp',
        'https://cdn.example.com/1.webp',
      ]);
      expect(onReorder).toHaveBeenCalledTimes(1);

      act(() => result.current.move(0, 1));
      expect(result.current.images.map((i) => i.url)).toEqual([
        'https://cdn.example.com/1.webp',
        'https://cdn.example.com/2.webp',
      ]);
    } finally {
      xhr.restore();
    }
  });

  it('AnimatedImage keeps blurred cover backdrop mounted for objectFit="contain", resolves aspectRatio="9:16", forwards blurhash to as={MockExpoImage}, and supports renderError retry', () => {
    vi.useFakeTimers();
    const { container, getByRole } = render(
      <div>
        <AnimatedImage
          src="https://cdn.example.com/story.webp"
          alt="Story preview"
          objectFit="contain"
          aspectRatio="9:16"
          blurDataUrl={SAMPLE_LQIP}
          blurColor="#334155"
        />
        <AnimatedImage
          as={MockExpoImage}
          src="https://cdn.example.com/expo.webp"
          alt="Expo image"
          blurHash="LEHV6nWB2yk8pyo0adR*.7kCMdnj"
          priority
          quality={88}
        />
        <AnimatedImage
          src="https://cdn.example.com/broken.webp"
          alt="Broken"
          blurDataUrl={SAMPLE_LQIP}
          renderError={({ retry }) => (
            <NativePressable onPress={retry} accessibilityLabel="Retry image">
              <NativeText>Retry image</NativeText>
            </NativePressable>
          )}
        />
      </div>,
    );

    const wrappers = container.querySelectorAll<HTMLElement>('[data-slot="animated-image"]');
    // jsdom >= 27 serializes a numeric aspect-ratio as "<n> / 1"; compare the ratio, not the string.
    const [num = '', den = '1'] = (wrappers[0]?.style.aspectRatio ?? '').split('/').map((p) => p.trim());
    expect(Number(num) / Number(den)).toBeCloseTo(9 / 16, 6);

    const mainContain = wrappers[0]!.querySelector<HTMLImageElement>('[data-slot="animated-image-main"]')!;
    fireEvent.load(mainContain);
    act(() => vi.advanceTimersByTime(1000));

    const retainedBackdrop = wrappers[0]!.querySelector<HTMLImageElement>('[data-slot="animated-image-placeholder"]');
    expect(retainedBackdrop).toBeInTheDocument();
    expect(retainedBackdrop).toHaveAttribute('data-resize-mode', 'cover');
    expect(retainedBackdrop).toHaveAttribute('data-blur-radius', '20');

    const expoEl = wrappers[1]!.querySelector('[data-expo-image="true"]')!;
    expect(expoEl).toHaveAttribute('data-blurhash', 'LEHV6nWB2yk8pyo0adR*.7kCMdnj');
    expect(expoEl).toHaveAttribute('data-priority', 'true');
    expect(expoEl).toHaveAttribute('data-quality', '88');

    const brokenMain = wrappers[2]!.querySelector<HTMLImageElement>('[data-slot="animated-image-main"]')!;
    fireEvent.error(brokenMain);
    expect(wrappers[2]).toHaveAttribute('data-state', 'error');

    fireEvent.click(getByRole('button', { name: 'Retry image' }));
    expect(wrappers[2]).toHaveAttribute('data-state', 'loading');
  });

  it('SingleImageUpload & MultiImageUpload render cover badge and reorder controls', () => {
    const imgA = makeUploadedImage({ url: 'https://cdn.example.com/a.webp' });
    const imgB = makeUploadedImage({ url: 'https://cdn.example.com/b.webp' });
    const onReorder = vi.fn();

    const { container } = render(
      <div>
        <SingleImageUpload defaultValue={imgA} />
        <MultiImageUpload defaultValue={[imgA, imgB]} reorderable showCoverBadge onReorder={onReorder} />
      </div>,
    );

    expect(container.querySelector('[data-slot="cover-badge"]')).toBeInTheDocument();
    fireEvent.click(container.querySelector<HTMLElement>('[data-slot="tile-set-cover"]')!);
    expect(onReorder).toHaveBeenCalledWith([imgB, imgA]);

    const deletedUrls: string[] = [];
    const { result, rerender } = renderHook(
      ({ val }) =>
        useNativeMultiUpload({
          value: val,
          customDeleter: async (u) => {
            deletedUrls.push(u);
            return true;
          },
        }),
      { initialProps: { val: [imgA] } },
    );
    expect(result.current.images).toEqual([imgA]);
    rerender({ val: [imgA, imgB] });
    expect(result.current.images).toEqual([imgA, imgB]);
    act(() => result.current.clearAll());
    expect(deletedUrls).toEqual([imgA.url, imgB.url]);
  });
});
