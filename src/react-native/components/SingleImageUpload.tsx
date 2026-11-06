import { resolveAspectRatio } from '../../types';
import { useNativeImageUploadConfig } from '../context';
import { useNativeSingleUpload } from '../hooks/useNativeSingleUpload';
import {
  flattenNativeStyle,
  NativeImage,
  NativePressable,
  type NativeStyleObject,
  NativeText,
  NativeView,
} from '../primitives';
import { resolveNativeTheme } from '../theme';
import type { NativeSingleImageUploadProps } from '../types';
import { AnimatedImage } from './AnimatedImage';

const LABELS = {
  en: {
    chooseLibrary: 'Choose from Library',
    takePhoto: 'Take Photo',
    uploading: 'Uploading...',
    cancel: 'Cancel',
    retry: 'Retry',
    remove: 'Remove',
    replace: 'Replace',
  },
  ar: {
    chooseLibrary: 'اختر من المكتبة',
    takePhoto: 'التقط صورة',
    uploading: 'جاري الرفع...',
    cancel: 'إلغاء',
    retry: 'إعادة المحاولة',
    remove: 'حذف',
    replace: 'استبدال',
  },
} as const;

export function SingleImageUpload(props: NativeSingleImageUploadProps) {
  const ctx = useNativeImageUploadConfig();
  const locale = props.locale ?? ctx.locale ?? 'en';
  const t = LABELS[locale];
  const palette = resolveNativeTheme({ ...ctx.theme, ...props.theme });
  const numericRatio = resolveAspectRatio(props.aspectRatio);

  const {
    image,
    previewUri,
    isUploading,
    progress,
    error,
    pickFromLibrary,
    takePhoto,
    cancel,
    retry,
    clear,
  } = useNativeSingleUpload(props);

  const state = props.disabled
    ? 'disabled'
    : isUploading
      ? 'uploading'
      : error
        ? 'error'
        : image
          ? 'ready'
          : 'idle';

  return (
    <NativeView
      testID={props.testID}
      data-slot="single-upload"
      data-state={state}
      style={{
        backgroundColor: palette.surface,
        borderColor: error ? palette.danger : palette.border,
        borderWidth: 1,
        borderRadius: palette.radiusMd,
        padding: 12,
        ...(flattenNativeStyle(props.style) as NativeStyleObject),
      }}
    >
      {previewUri ? (
        <NativeView
          data-slot="single-preview"
          style={{
            position: 'relative',
            borderRadius: palette.radiusSm,
            overflow: 'hidden',
            ...(numericRatio ? { aspectRatio: numericRatio } : { minHeight: 180 }),
          }}
        >
          {image && !isUploading ? (
            <AnimatedImage
              image={image}
              aspectRatio={props.aspectRatio}
              reduceMotion={props.reduceMotion}
            />
          ) : (
            <NativeImage
              data-slot="optimistic-preview"
              source={{ uri: previewUri }}
              alt={props.altText ?? 'Preview'}
              resizeMode="cover"
              style={{
                width: '100%',
                height: '100%',
                opacity: isUploading ? 0.65 : 1,
              }}
            />
          )}

          {isUploading ? (
            <NativeView
              data-slot="upload-progress"
              style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                right: 8,
                backgroundColor: palette.bg,
                borderRadius: palette.radiusSm,
                padding: 8,
              }}
            >
              <NativeText style={{ color: palette.text, fontSize: 12 }}>
                {`${t.uploading} ${progress}%`}
              </NativeText>
              <NativePressable
                data-slot="cancel-button"
                accessibilityLabel={t.cancel}
                onPress={cancel}
                style={{
                  marginTop: 6,
                  padding: 6,
                  backgroundColor: palette.dangerSoft,
                  borderRadius: palette.radiusSm,
                }}
              >
                <NativeText style={{ color: palette.danger, fontSize: 12 }}>
                  {t.cancel}
                </NativeText>
              </NativePressable>
            </NativeView>
          ) : null}
        </NativeView>
      ) : null}

      {error ? (
        <NativeView
          data-slot="upload-error"
          accessibilityRole="alert"
          style={{
            marginTop: 8,
            padding: 8,
            backgroundColor: palette.dangerSoft,
            borderRadius: palette.radiusSm,
          }}
        >
          <NativeText style={{ color: palette.danger, fontSize: 12 }}>
            {error}
          </NativeText>
          <NativePressable
            data-slot="retry-button"
            accessibilityLabel={t.retry}
            onPress={() => void retry()}
            style={{
              marginTop: 6,
              padding: 6,
              backgroundColor: palette.danger,
              borderRadius: palette.radiusSm,
            }}
          >
            <NativeText style={{ color: '#ffffff', fontSize: 12 }}>
              {t.retry}
            </NativeText>
          </NativePressable>
        </NativeView>
      ) : null}

      <NativeView
        data-slot="single-actions"
        style={{
          flexDirection: 'row',
          gap: 8,
          marginTop: previewUri || error ? 10 : 0,
        }}
      >
        <NativePressable
          data-slot="library-button"
          disabled={props.disabled || isUploading}
          accessibilityLabel={t.chooseLibrary}
          onPress={() => void pickFromLibrary()}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            backgroundColor: palette.primary,
            borderRadius: palette.radiusSm,
          }}
        >
          <NativeText style={{ color: '#ffffff', fontSize: 13 }}>
            {image ? t.replace : t.chooseLibrary}
          </NativeText>
        </NativePressable>

        <NativePressable
          data-slot="camera-button"
          disabled={props.disabled || isUploading}
          accessibilityLabel={t.takePhoto}
          onPress={() => void takePhoto()}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            backgroundColor: palette.surfaceHover,
            borderColor: palette.borderStrong,
            borderWidth: 1,
            borderRadius: palette.radiusSm,
          }}
        >
          <NativeText style={{ color: palette.text, fontSize: 13 }}>
            {t.takePhoto}
          </NativeText>
        </NativePressable>

        {image && !isUploading ? (
          <NativePressable
            data-slot="remove-button"
            disabled={props.disabled}
            accessibilityLabel={t.remove}
            onPress={() => void clear()}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              backgroundColor: palette.dangerSoft,
              borderRadius: palette.radiusSm,
            }}
          >
            <NativeText style={{ color: palette.danger, fontSize: 13 }}>
              {t.remove}
            </NativeText>
          </NativePressable>
        ) : null}
      </NativeView>
    </NativeView>
  );
}

export default SingleImageUpload;
