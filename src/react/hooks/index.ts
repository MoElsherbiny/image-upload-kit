import { useEffect } from 'react';
import {
  blurService,
  type BlurSize,
  useProgressiveBlur,
} from './useBlurService';

export * from './useBlurService';
export { useDialog, type UseDialogOptions } from './useDialog';
export {
  useDragAndDrop,
  type UseDragAndDropOptions,
} from './useDragAndDrop';
export { useFilePreview, type UseFilePreviewOptions } from './useFilePreview';
export {
  type UploadCallOptions,
  useImageUpload,
  type UseImageUploadOptions,
} from './useImageUpload';
export {
  buildUploadFormData,
  createUploadAbortError,
  isUploadAbortError,
  parseErrorPayload,
  type UploadFormFields,
  uploadViaXhr,
  type XhrUploadOptions,
} from './xhrUpload';

export const useProgressiveImage = useProgressiveBlur;

export function useBlurPreload(
  imageSrcs: string[],
  size: BlurSize = 'small',
): void {
  useEffect(() => {
    if (imageSrcs.length > 0) {
      blurService.preloadBlurData(imageSrcs, size);
    }
  }, [imageSrcs, size]);
}
