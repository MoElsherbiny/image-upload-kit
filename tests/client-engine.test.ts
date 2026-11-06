import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAssetToFormData,
  buildUploadFormData,
  composeTransforms,
  createClientResizeTransform,
  createUploadTracker,
  deleteUploadedImage,
  getAssetMimeType,
  getAssetName,
  getAssetPreviewUri,
  getAssetSize,
  isHeicAsset,
  isNativeAsset,
  moveItem,
  promoteToCover,
  runTransformAsset,
  uploadAsset,
  type NativeUploadAsset,
} from '../src/client';
import {
  aspectRatioToCss,
  resolveAspectRatio,
  STANDARD_PRESETS,
} from '../src/types';

describe('Shared Client Engine (img-upload-kit/client) & Aspect Ratio Helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves named and numeric aspect ratios to numbers and CSS strings', () => {
    expect(resolveAspectRatio('1:1')).toBe(1);
    expect(resolveAspectRatio('4:5')).toBeCloseTo(0.8, 5);
    expect(resolveAspectRatio('9:16')).toBeCloseTo(9 / 16, 5);
    expect(resolveAspectRatio('16:9')).toBeCloseTo(16 / 9, 5);
    expect(resolveAspectRatio(1.5)).toBe(1.5);
    expect(resolveAspectRatio('auto')).toBeUndefined();
    expect(resolveAspectRatio(undefined)).toBeUndefined();

    expect(aspectRatioToCss('4:5')).toBe('4 / 5');
    expect(aspectRatioToCss('9:16')).toBe('9 / 16');
    expect(aspectRatioToCss(1.91)).toBe('1.91');
    expect(aspectRatioToCss('auto')).toBe('auto');
    expect(aspectRatioToCss(undefined)).toBeUndefined();
  });

  it('includes square, portrait, and story presets with aspect ratios', () => {
    expect(STANDARD_PRESETS.square.aspectRatio).toBe('1:1');
    expect(STANDARD_PRESETS.portrait.aspectRatio).toBe('4:5');
    expect(STANDARD_PRESETS.story.aspectRatio).toBe('9:16');
  });

  it('reorders items and promotes cover immutably with bounds clamping', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(moveItem(items, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveItem(items, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(items, 1, 1)).toEqual(['a', 'b', 'c', 'd']);
    expect(moveItem(items, -5, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(promoteToCover(items, 3)).toEqual(['d', 'a', 'b', 'c']);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });

  it('inspects NativeUploadAsset metadata, synthesizes Android content:// filenames, and detects HEIC', () => {
    const androidAsset: NativeUploadAsset = {
      uri: 'content://media/external/images/media/10923',
      type: 'image/webp',
      size: 48120,
    };
    expect(isNativeAsset(androidAsset)).toBe(true);
    expect(getAssetName(androidAsset, 0)).toBe('upload-1.webp');
    expect(getAssetMimeType(androidAsset)).toBe('image/webp');
    expect(getAssetSize(androidAsset)).toBe(48120);
    expect(getAssetPreviewUri(androidAsset)).toBe(androidAsset.uri);
    expect(isHeicAsset(androidAsset)).toBe(false);

    const iosHeic: NativeUploadAsset = {
      uri: 'file:///var/mobile/Media/DCIM/100APPLE/IMG_0042.HEIC',
    };
    expect(isHeicAsset(iosHeic)).toBe(true);
    expect(getAssetMimeType(iosHeic)).toBe('image/heic');

    const formData = new FormData();
    appendAssetToFormData(formData, 'file', androidAsset);
    expect(formData.has('file')).toBe(true);

    const fullForm = buildUploadFormData(androidAsset, {
      preset: 'portrait',
      aspectRatio: '4:5',
      crop: 'attention',
    });
    expect(fullForm.get('preset')).toBe('portrait');
    expect(fullForm.get('aspectRatio')).toBe('4:5');
    expect(fullForm.get('crop')).toBe('attention');
  });

  it('runs transformAsset with AbortSignal enforcement and tracks NativeUploadAsset entries', async () => {
    const asset: NativeUploadAsset = {
      uri: 'file:///tmp/raw.jpg',
      name: 'raw.jpg',
      type: 'image/jpeg',
    };
    const tracker = createUploadTracker<NativeUploadAsset>();
    const entry = tracker.createEntry(asset, 'Transforming…');

    const transformed = await runTransformAsset(
      asset,
      async (input) => ({ ...input, uri: 'file:///tmp/cropped.jpg' }),
      { signal: entry.controller.signal, preset: 'square', index: 0 },
    );
    expect(transformed.uri).toBe('file:///tmp/cropped.jpg');

    tracker.abortByIdOrFile(entry.id);
    await expect(
      runTransformAsset(
        asset,
        async (input) => input,
        { signal: entry.controller.signal, preset: 'square', index: 0 },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('supports createClientResizeTransform, composeTransforms, deleteUploadedImage, and presigned uploadAsset', async () => {
    const controller = new AbortController();
    const svgFile = new File(['<svg></svg>'], 'logo.svg', {
      type: 'image/svg+xml',
    });
    const resize = createClientResizeTransform({
      maxWidth: 1024,
      maxHeight: 1024,
    });
    // Passes through SVG or environments without OffscreenCanvas
    const passed = await resize(svgFile, {
      signal: controller.signal,
      index: 0,
    });
    expect(passed).toBe(svgFile);

    // Falls back to original asset when createImageBitmap rejects (e.g. corrupt/CMYK/HEIC)
    const origBitmap = globalThis.createImageBitmap;
    const origOffscreen = globalThis.OffscreenCanvas;
    try {
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        writable: true,
        value: vi.fn().mockRejectedValueOnce(new Error('Decode error')),
      });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        writable: true,
        value: class MockOffscreen {
          getContext() {
            return { drawImage: vi.fn() };
          }
          async convertToBlob() {
            return new Blob(['1234567890-larger-blob'], { type: 'image/webp' });
          }
        },
      });
      const rawJpg = new File(['tiny'], 'raw.jpg', { type: 'image/jpeg' });
      const fallbackOnDecodeErr = await resize(rawJpg, {
        signal: controller.signal,
        index: 0,
      });
      expect(fallbackOnDecodeErr).toBe(rawJpg);

      // Falls back to original asset if re-encoded blob is >= original byte size
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        writable: true,
        value: vi.fn().mockResolvedValueOnce({
          width: 4000,
          height: 3000,
          close: vi.fn(),
        }),
      });
      const fallbackOnLargerSize = await resize(rawJpg, {
        signal: controller.signal,
        index: 0,
      });
      expect(fallbackOnLargerSize).toBe(rawJpg);
    } finally {
      Object.defineProperty(globalThis, 'createImageBitmap', {
        configurable: true,
        writable: true,
        value: origBitmap,
      });
      Object.defineProperty(globalThis, 'OffscreenCanvas', {
        configurable: true,
        writable: true,
        value: origOffscreen,
      });
    }

    // Composes multiple transforms sequentially
    const composed = composeTransforms<NativeUploadAsset>(
      async (a) => ({ ...a, name: 'step1.jpg' }),
      async (a) => ({ ...a, name: `${a.name}-step2` }),
    );
    const composedOut = await composed(
      { uri: 'file:///a.jpg' },
      { signal: controller.signal, index: 0 },
    );
    expect(composedOut.name).toBe('step1.jpg-step2');

    // deleteUploadedImage sends DELETE with encoded url query parameter
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      // Presigned 3-step mock (presign -> PUT -> finalize)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            upload: {
              method: 'PUT',
              url: 'https://storage.example.com/staged/1',
              headers: { 'x-amz-acl': 'private' },
            },
            token: 'signed-token-123',
            expiresAt: '2030-01-01T00:00:00.000Z',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: 'https://cdn.example.com/final.webp',
            blurDataUrl: 'data:image/webp;base64,AAAA',
            blurColor: '#123456',
            width: 800,
            height: 800,
            format: 'webp',
            size: 1024,
            contentHash: 'abc12345',
            uploadedAt: '2026-11-06T00:00:00.000Z',
          }),
          { status: 200 },
        ),
      );

    await deleteUploadedImage(
      '/api/upload',
      'https://cdn.example.com/img 1.webp',
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      '/api/upload?url=https%3A%2F%2Fcdn.example.com%2Fimg%201.webp',
      expect.objectContaining({ method: 'DELETE' }),
    );

    const jpgFile = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const uploaded = await uploadAsset(
      jpgFile,
      { preset: 'square', altText: 'Shoe' },
      { endpoint: '/api/upload', mode: 'presigned' },
    );
    expect(uploaded.url).toBe('https://cdn.example.com/final.webp');
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      '/api/upload?action=presign',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      'https://storage.example.com/staged/1',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      '/api/upload?action=finalize',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
