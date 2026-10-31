import type { ReactElement } from 'react';
import type { UploadPresetName } from '../../types';
import type { HeadlessMultiUploadProps } from './types';
import { useMultiUpload } from './useMultiUpload';

/**
 * Headless render-prop primitive for multi-image and folder upload workflows.
 * Renders zero DOM elements of its own and delegates 100% of markup and styling to `children(controller)`.
 */
export function HeadlessMultiUpload<
  TPreset extends string = UploadPresetName,
>(props: HeadlessMultiUploadProps<TPreset>): ReactElement {
  const controller = useMultiUpload<TPreset>(props);
  return <>{props.children(controller)}</>;
}

export default HeadlessMultiUpload;
