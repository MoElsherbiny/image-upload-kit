import {
  type ComponentType,
  createElement,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

export type NativeStyleObject = Record<string, string | number | undefined>;
export type NativeStyleProp =
  | NativeStyleObject
  | ReadonlyArray<NativeStyleObject | undefined | null | false>
  | undefined;

export type NativeResizeMode = 'cover' | 'contain' | 'stretch' | 'center';

export interface NativeImageSource {
  uri: string;
  headers?: Record<string, string>;
  width?: number;
  height?: number;
}

export interface NativeBaseProps {
  testID?: string;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  accessibilityState?: {
    disabled?: boolean;
    busy?: boolean;
    selected?: boolean;
  };
  style?: NativeStyleProp;
  'data-slot'?: string;
  'data-state'?: string;
  'data-index'?: number | string;
}

export interface NativeViewProps extends NativeBaseProps {
  children?: ReactNode;
}

export interface NativeTextProps extends NativeBaseProps {
  children?: ReactNode;
  numberOfLines?: number;
}

export interface NativeImageProps extends NativeBaseProps {
  source: NativeImageSource | string;
  alt?: string;
  resizeMode?: NativeResizeMode;
  blurRadius?: number;
  onLoad?: (event?: SyntheticEvent) => void;
  onError?: (event?: SyntheticEvent) => void;
}

export interface NativePressableState {
  pressed: boolean;
}

export interface NativePressableProps extends NativeBaseProps {
  children?: ReactNode | ((state: NativePressableState) => ReactNode);
  disabled?: boolean;
  onPress?: () => void;
}

export interface NativePrimitives {
  View: ComponentType<NativeViewProps>;
  Text: ComponentType<NativeTextProps>;
  Image: ComponentType<NativeImageProps>;
  Pressable: ComponentType<NativePressableProps>;
}

export function flattenNativeStyle(style?: NativeStyleProp): CSSProperties {
  if (!style) return {};
  if (Array.isArray(style)) {
    const merged: NativeStyleObject = {};
    for (const item of style) {
      if (item && typeof item === 'object') {
        Object.assign(merged, item);
      }
    }
    return merged as unknown as CSSProperties;
  }
  return { ...(style as NativeStyleObject) } as unknown as CSSProperties;
}

function mapResizeModeToObjectFit(
  mode?: NativeResizeMode,
): CSSProperties['objectFit'] {
  if (!mode) return undefined;
  if (mode === 'stretch') return 'fill';
  if (mode === 'center') return 'none';
  return mode;
}

const FallbackView: ComponentType<NativeViewProps> = ({
  children,
  testID,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  style,
  ...rest
}) =>
  createElement(
    'div',
    {
      ...rest,
      'data-rn-view': '',
      'data-testid': testID,
      role: accessibilityRole,
      'aria-label': accessibilityLabel,
      'aria-busy': accessibilityState?.busy || undefined,
      'aria-disabled': accessibilityState?.disabled || undefined,
      style: flattenNativeStyle(style),
    },
    children,
  );

const FallbackText: ComponentType<NativeTextProps> = ({
  children,
  testID,
  accessibilityRole,
  accessibilityLabel,
  style,
  numberOfLines,
  ...rest
}) =>
  createElement(
    'span',
    {
      ...rest,
      'data-rn-text': '',
      'data-testid': testID,
      'data-lines': numberOfLines,
      role: accessibilityRole,
      'aria-label': accessibilityLabel,
      style: flattenNativeStyle(style),
    },
    children,
  );

const FallbackImage: ComponentType<NativeImageProps> = ({
  source,
  alt,
  resizeMode,
  blurRadius,
  testID,
  accessibilityRole,
  accessibilityLabel,
  style,
  onLoad,
  onError,
  ...rest
}) => {
  const src = typeof source === 'string' ? source : source?.uri ?? '';
  const baseStyle = flattenNativeStyle(style);
  const objectFit = mapResizeModeToObjectFit(resizeMode) ?? baseStyle.objectFit;
  const filter =
    typeof blurRadius === 'number' && blurRadius > 0
      ? `blur(${blurRadius}px)`
      : baseStyle.filter;
  return createElement('img', {
    ...rest,
    src,
    alt: accessibilityLabel ?? alt ?? '',
    'data-rn-image': '',
    'data-testid': testID,
    'data-resize-mode': resizeMode,
    'data-blur-radius':
      typeof blurRadius === 'number' ? String(blurRadius) : undefined,
    role: accessibilityRole,
    style: {
      ...baseStyle,
      ...(objectFit ? { objectFit } : {}),
      ...(filter ? { filter } : {}),
    },
    onLoad,
    onError,
  });
};

const FallbackPressable: ComponentType<NativePressableProps> = ({
  children,
  disabled,
  onPress,
  testID,
  accessibilityRole,
  accessibilityLabel,
  style,
  ...rest
}) =>
  createElement(
    'button',
    {
      ...rest,
      type: 'button',
      disabled,
      onClick: disabled ? undefined : onPress,
      'data-rn-pressable': '',
      'data-testid': testID,
      role: accessibilityRole,
      'aria-label': accessibilityLabel,
      style: flattenNativeStyle(style),
    },
    typeof children === 'function' ? children({ pressed: false }) : children,
  );

const defaultPrimitives: NativePrimitives = {
  View: FallbackView,
  Text: FallbackText,
  Image: FallbackImage,
  Pressable: FallbackPressable,
};

let activePrimitives: NativePrimitives = { ...defaultPrimitives };

export function configureNativePrimitives(
  custom: Partial<NativePrimitives>,
): void {
  activePrimitives = {
    ...activePrimitives,
    ...custom,
  };
}

export function resetNativePrimitives(): void {
  activePrimitives = { ...defaultPrimitives };
}

export function getNativePrimitives(): NativePrimitives {
  return activePrimitives;
}

export function NativeView(props: NativeViewProps) {
  return createElement(activePrimitives.View, props);
}

export function NativeText(props: NativeTextProps) {
  return createElement(activePrimitives.Text, props);
}

export function NativeImage(props: NativeImageProps) {
  return createElement(activePrimitives.Image, props);
}

export function NativePressable(props: NativePressableProps) {
  return createElement(activePrimitives.Pressable, props);
}
