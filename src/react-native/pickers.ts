import type { NativeUploadAsset } from '../client';
import {
  type NativeImagePickerAdapter,
  type NativeImagePickerOptions,
  PickerPermissionError,
} from './types';

export interface ExpoPermissionResponseLike {
  granted: boolean;
  status?: string;
}

export interface ExpoPickedAssetLike {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number;
  width?: number;
  height?: number;
}

export interface ExpoPickerResultLike {
  canceled: boolean;
  assets?: ExpoPickedAssetLike[] | null;
}

export interface ExpoLaunchOptionsLike {
  mediaTypes?: unknown;
  allowsMultipleSelection?: boolean;
  selectionLimit?: number;
  quality?: number;
  preferredAssetRepresentationMode?: 'compatible' | 'current' | 'automatic';
  aspect?: [number, number];
}

export interface ExpoImagePickerLike {
  requestMediaLibraryPermissionsAsync?: () => Promise<ExpoPermissionResponseLike>;
  requestCameraPermissionsAsync?: () => Promise<ExpoPermissionResponseLike>;
  launchImageLibraryAsync: (
    options?: ExpoLaunchOptionsLike,
  ) => Promise<ExpoPickerResultLike>;
  launchCameraAsync: (
    options?: ExpoLaunchOptionsLike,
  ) => Promise<ExpoPickerResultLike>;
}

export interface RnPickedAssetLike {
  uri?: string;
  fileName?: string;
  type?: string;
  fileSize?: number;
  width?: number;
  height?: number;
}

export interface RnPickerResponseLike {
  didCancel?: boolean;
  errorCode?: 'camera_unavailable' | 'permission' | 'others' | string;
  errorMessage?: string;
  assets?: RnPickedAssetLike[];
}

export interface RnLaunchOptionsLike {
  mediaType: 'photo' | 'video' | 'mixed';
  selectionLimit?: number;
  quality?: number;
  assetRepresentationMode?: 'compatible' | 'current' | 'auto';
}

export interface RnImagePickerLike {
  launchImageLibrary: (
    options: RnLaunchOptionsLike,
  ) => Promise<RnPickerResponseLike>;
  launchCamera: (options: RnLaunchOptionsLike) => Promise<RnPickerResponseLike>;
}

function mapExpoAssets(
  result: ExpoPickerResultLike,
  maxFiles?: number,
): NativeUploadAsset[] {
  if (result.canceled || !Array.isArray(result.assets)) {
    return [];
  }
  const assets = result.assets
    .filter((item) => Boolean(item && typeof item.uri === 'string' && item.uri))
    .map(
      (asset): NativeUploadAsset => ({
        uri: asset.uri,
        name: asset.fileName ?? undefined,
        type: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
      }),
    );
  return typeof maxFiles === 'number' && maxFiles > 0
    ? assets.slice(0, maxFiles)
    : assets;
}

export function createExpoImagePickerAdapter(
  ExpoImagePicker: ExpoImagePickerLike,
  defaults?: NativeImagePickerOptions,
): NativeImagePickerAdapter {
  const buildExpoOptions = (
    options?: NativeImagePickerOptions,
    allowMulti = true,
  ): { merged: NativeImagePickerOptions; launch: ExpoLaunchOptionsLike } => {
    const merged: NativeImagePickerOptions = { ...defaults, ...options };
    const multiple = allowMulti ? Boolean(merged.multiple) : false;
    return {
      merged,
      launch: {
        preferredAssetRepresentationMode: 'compatible',
        allowsMultipleSelection: multiple,
        selectionLimit: multiple ? merged.maxFiles : 1,
        quality: merged.quality ?? 0.92,
      },
    };
  };

  return {
    async pickFromLibrary(options) {
      if (ExpoImagePicker.requestMediaLibraryPermissionsAsync) {
        const perm =
          await ExpoImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          throw new PickerPermissionError('library');
        }
      }
      const { merged, launch } = buildExpoOptions(options, true);
      const result = await ExpoImagePicker.launchImageLibraryAsync(launch);
      return mapExpoAssets(result, merged.maxFiles);
    },

    async takePhoto(options) {
      if (ExpoImagePicker.requestCameraPermissionsAsync) {
        const perm = await ExpoImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          throw new PickerPermissionError('camera');
        }
      }
      const { launch } = buildExpoOptions(options, false);
      const result = await ExpoImagePicker.launchCameraAsync(launch);
      return mapExpoAssets(result, 1);
    },
  };
}

function mapRnAssets(
  response: RnPickerResponseLike,
  source: 'camera' | 'library',
  maxFiles?: number,
): NativeUploadAsset[] {
  if (response.errorCode === 'permission') {
    throw new PickerPermissionError(source, response.errorMessage);
  }
  if (response.errorCode) {
    throw new Error(
      response.errorMessage || `Image picker error: ${response.errorCode}`,
    );
  }
  if (response.didCancel || !Array.isArray(response.assets)) {
    return [];
  }
  const assets = response.assets
    .filter((item): item is RnPickedAssetLike & { uri: string } =>
      Boolean(item && typeof item.uri === 'string' && item.uri),
    )
    .map(
      (asset): NativeUploadAsset => ({
        uri: asset.uri,
        name: asset.fileName ?? undefined,
        type: asset.type ?? 'image/jpeg',
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
      }),
    );
  return typeof maxFiles === 'number' && maxFiles > 0
    ? assets.slice(0, maxFiles)
    : assets;
}

export function createRnImagePickerAdapter(
  RnImagePicker: RnImagePickerLike,
  defaults?: NativeImagePickerOptions,
): NativeImagePickerAdapter {
  return {
    async pickFromLibrary(options) {
      const merged: NativeImagePickerOptions = { ...defaults, ...options };
      const multiple = Boolean(merged.multiple);
      const response = await RnImagePicker.launchImageLibrary({
        mediaType: 'photo',
        assetRepresentationMode: 'compatible',
        selectionLimit: multiple ? (merged.maxFiles ?? 0) : 1,
        quality: merged.quality ?? 0.92,
      });
      return mapRnAssets(response, 'library', merged.maxFiles);
    },

    async takePhoto(options) {
      const merged: NativeImagePickerOptions = { ...defaults, ...options };
      const response = await RnImagePicker.launchCamera({
        mediaType: 'photo',
        assetRepresentationMode: 'compatible',
        selectionLimit: 1,
        quality: merged.quality ?? 0.92,
      });
      return mapRnAssets(response, 'camera', 1);
    },
  };
}
