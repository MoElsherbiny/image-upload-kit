import { createElement } from 'react';
import { vi } from 'vitest';
import type {
  ExpoImagePickerLike,
  ExpoPickedAssetLike,
  NativeUploadAsset,
  RnImagePickerLike,
  RnPickedAssetLike,
} from '../../src/react-native';
import type { UploadedImageData } from '../../src/types';

export const SAMPLE_LQIP =
  'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

export function makeNativeAsset(
  overrides: Partial<NativeUploadAsset> = {},
): NativeUploadAsset {
  return {
    uri: 'file:///var/mobile/Media/DCIM/100APPLE/IMG_0001.JPG',
    name: 'IMG_0001.JPG',
    type: 'image/jpeg',
    size: 120_000,
    width: 1200,
    height: 900,
    ...overrides,
  };
}

export function makeUploadedImage(
  overrides: Partial<UploadedImageData> = {},
): UploadedImageData {
  return {
    url: 'https://cdn.example.com/uploads/img-1.webp',
    blurDataUrl: SAMPLE_LQIP,
    blurColor: '#3b82f6',
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    altText: 'Sample uploaded image',
    width: 1200,
    height: 900,
    format: 'webp',
    size: 42_000,
    contentHash: 'abc12345',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockExpoImagePicker(options?: {
  libraryGranted?: boolean;
  cameraGranted?: boolean;
  canceled?: boolean;
  assets?: ExpoPickedAssetLike[];
}) {
  const libraryGranted = options?.libraryGranted ?? true;
  const cameraGranted = options?.cameraGranted ?? true;
  const canceled = options?.canceled ?? false;
  const assets: ExpoPickedAssetLike[] = options?.assets ?? [
    {
      uri: 'file:///expo/library/photo-1.jpg',
      fileName: 'photo-1.jpg',
      mimeType: 'image/jpeg',
      fileSize: 98_000,
      width: 1080,
      height: 1350,
    },
  ];

  const mock: ExpoImagePickerLike = {
    requestMediaLibraryPermissionsAsync: vi.fn(async () => ({
      granted: libraryGranted,
    })),
    requestCameraPermissionsAsync: vi.fn(async () => ({
      granted: cameraGranted,
    })),
    launchImageLibraryAsync: vi.fn(async () => ({
      canceled,
      assets: canceled ? null : assets,
    })),
    launchCameraAsync: vi.fn(async () => ({
      canceled,
      assets: canceled ? null : assets.slice(0, 1),
    })),
  };

  return mock;
}

export function createMockRnImagePicker(options?: {
  didCancel?: boolean;
  errorCode?: string;
  errorMessage?: string;
  assets?: RnPickedAssetLike[];
}) {
  const assets: RnPickedAssetLike[] = options?.assets ?? [
    {
      uri: 'file:///rn/library/photo-1.jpg',
      fileName: 'photo-1.jpg',
      type: 'image/jpeg',
      fileSize: 84_000,
      width: 1080,
      height: 1080,
    },
  ];

  const mock: RnImagePickerLike = {
    launchImageLibrary: vi.fn(async () => ({
      didCancel: options?.didCancel,
      errorCode: options?.errorCode,
      errorMessage: options?.errorMessage,
      assets: options?.didCancel || options?.errorCode ? undefined : assets,
    })),
    launchCamera: vi.fn(async () => ({
      didCancel: options?.didCancel,
      errorCode: options?.errorCode,
      errorMessage: options?.errorMessage,
      assets:
        options?.didCancel || options?.errorCode
          ? undefined
          : assets.slice(0, 1),
    })),
  };

  return mock;
}

export function MockExpoImage(props: Record<string, unknown>) {
  const { placeholder, contentFit, priority, quality, source, onLoad, onError } =
    props as {
      placeholder?: { blurhash?: string };
      contentFit?: string;
      priority?: boolean;
      quality?: number;
      source?: { uri?: string };
      onLoad?: () => void;
      onError?: () => void;
    };

  return createElement('img', {
    'data-expo-image': 'true',
    'data-blurhash': placeholder?.blurhash,
    'data-content-fit': contentFit,
    'data-priority': priority ? 'true' : undefined,
    'data-quality': quality !== undefined ? String(quality) : undefined,
    src: source?.uri ?? '',
    alt: (props.alt as string) ?? '',
    onLoad,
    onError,
  });
}
