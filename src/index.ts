export * from './types';
export * from './utils/color';
export * from './utils/formatters';
export * from './utils/validators';

// Re-export core storage contracts & standard in-memory adapter
export type {
  StorageAdapter,
  StorageUploadParams,
  StorageUploadOptions,
  StorageUploadResult,
  StorageFileEntry,
  StorageListResult,
  StorageFileMetadata,
} from './storage/types';
export { createMemoryStorageAdapter } from './storage/memoryAdapter';

// Re-export blur placeholders & hash decoding for universal consumption
export type {
  BlurData,
  BlurImageSource,
  BlurPlaceholderType,
  BlurServiceConfig,
} from './blur/types';
export type { BlurServiceOptions } from './blur/blurService';
export {
  decodeBlurHashToDataURL,
  getBlurData,
  getImagePropsWithBlur,
  getBackgroundPropsWithBlur,
} from './blur/blurDataUtils';

