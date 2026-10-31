import type { CSSProperties } from 'react';
import type { UploadVisualState } from '../styling';

/**
 * Inline style applied to `<input type="file">` when `unstyled` mode is active
 * so hidden file inputs remain invisible even when `image-upload-kit/styles.css` is not imported.
 */
export const HIDDEN_INPUT_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Joins truthy CSS class names cleanly.
 */
export function cx(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
}

/**
 * Resolves a component slot's final `className`:
 * - When `unstyled` is `false` (default): includes `defaultClass` followed by provider & prop overrides.
 * - When `unstyled` is `true`: strips `defaultClass` (`iuk-*`) and applies only user-supplied classes.
 */
export function resolveSlotClass(
  defaultClass: string | undefined,
  unstyled: boolean | undefined,
  ...customClasses: Array<string | false | null | undefined>
): string | undefined {
  const merged = unstyled
    ? cx(...customClasses)
    : cx(defaultClass, ...customClasses);
  return merged || undefined;
}

/**
 * Merges multiple optional inline `CSSProperties` objects for a slot.
 */
export function resolveSlotStyle(
  ...styles: Array<CSSProperties | undefined>
): CSSProperties | undefined {
  let result: CSSProperties | undefined;
  for (const style of styles) {
    if (style) {
      result = result ? { ...result, ...style } : { ...style };
    }
  }
  return result;
}

/**
 * Computes a deterministic semantic state string for `data-state="..."` styling
 * (e.g. Tailwind `data-[state=dragging]:border-indigo-500` or CSS `[data-state="uploading"]`).
 */
export function resolveUploadDataState(flags: {
  disabled?: boolean;
  hasError?: boolean;
  isUploading?: boolean;
  isDragging?: boolean;
  hasContent?: boolean;
}): UploadVisualState {
  if (flags.disabled) return 'disabled';
  if (flags.isDragging) return 'dragging';
  if (flags.isUploading) return 'uploading';
  if (flags.hasError) return 'error';
  if (flags.hasContent) return 'ready';
  return 'idle';
}
