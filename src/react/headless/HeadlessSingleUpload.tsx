import type { ReactElement } from 'react';
import type { UploadPresetName } from '../../types';
import type { HeadlessSingleUploadProps } from './types';
import { useSingleUpload } from './useSingleUpload';

/**
 * Headless render-prop primitive for single-image upload workflows.
 * Renders zero DOM elements of its own and delegates 100% of markup and styling to `children(controller)`.
 */
export function HeadlessSingleUpload<
  TPreset extends string = UploadPresetName,
>(props: HeadlessSingleUploadProps<TPreset>): ReactElement {
  const controller = useSingleUpload<TPreset>(props);
  return <>{props.children(controller)}</>;
}

export default HeadlessSingleUpload;
