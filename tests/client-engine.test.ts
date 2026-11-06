import { describe, expect, it } from 'vitest';
import {
  appendAssetToFormData,
  buildUploadFormData,
  createUploadTracker,
  getAssetMimeType,
  getAssetName,
  getAssetPreviewUri,
  getAssetSize,
  isHeicAsset,
  isNativeAsset,
  moveItem,
  promoteToCover,
  runTransformAsset,
  type NativeUploadAsset,
} from '../src/client';
import {
  aspectRatioToCss,
  resolveAspectRatio,
  STANDARD_PRESETS,
} from '../src/types';

describe('Shared Client Engine (img-upload-kit/client) & Aspect Ratio Helpers', () => {
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
    // Original array is untouched
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
});
