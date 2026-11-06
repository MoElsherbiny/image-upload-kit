import { resolveAspectRatio } from '../../types';
import { useNativeImageUploadConfig } from '../context';
import { useNativeMultiUpload } from '../hooks/useNativeMultiUpload';
import {
  flattenNativeStyle,
  NativeImage,
  NativePressable,
  type NativeStyleObject,
  NativeText,
  NativeView,
} from '../primitives';
import { resolveNativeTheme } from '../theme';
import type { NativeMultiImageUploadProps } from '../types';
import { AnimatedImage } from './AnimatedImage';

const LABELS = {
  en: {
    addLibrary: 'Add from Library',
    takePhoto: 'Take Photo',
    cover: 'Cover',
    moveEarlier: 'Move Earlier',
    moveLater: 'Move Later',
    setCover: 'Set as Cover',
    cancel: 'Cancel',
    retry: 'Retry',
    remove: 'Remove',
  },
  ar: {
    addLibrary: 'إضافة من المكتبة',
    takePhoto: 'التقط صورة',
    cover: 'الغلاف',
    moveEarlier: 'تحريك للأمام',
    moveLater: 'تحريك للخلف',
    setCover: 'تعيين كغلاف',
    cancel: 'إلغاء',
    retry: 'إعادة المحاولة',
    remove: 'حذف',
  },
} as const;

export function MultiImageUpload(props: NativeMultiImageUploadProps) {
  const ctx = useNativeImageUploadConfig();
  const locale = props.locale ?? ctx.locale ?? 'en';
  const t = LABELS[locale];
  const palette = resolveNativeTheme({ ...ctx.theme, ...props.theme });
  const reorderable = props.reorderable ?? true;
  const showCoverBadge = props.showCoverBadge ?? true;
  const numericRatio = resolveAspectRatio(props.aspectRatio) ?? 1;

  const {
    items,
    isUploading,
    error,
    canAddMore,
    pickFromLibrary,
    takePhoto,
    removeItem,
    cancelItem,
    retryItem,
    move,
    setCover,
  } = useNativeMultiUpload(props);

  const state = props.disabled
    ? 'disabled'
    : isUploading
      ? 'uploading'
      : error
        ? 'error'
        : items.length > 0
          ? 'ready'
          : 'idle';

  return (
    <NativeView
      testID={props.testID}
      data-slot="multi-upload"
      data-state={state}
      style={{
        backgroundColor: palette.surface,
        borderColor: palette.border,
        borderWidth: 1,
        borderRadius: palette.radiusMd,
        padding: 12,
        ...(flattenNativeStyle(props.style) as NativeStyleObject),
      }}
    >
      <NativeView data-slot="multi-grid" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {items.map((item, index) => (
          <NativeView
            key={item.id}
            data-slot="multi-tile"
            data-index={index}
            data-state={item.isUploading ? 'uploading' : item.error ? 'error' : 'ready'}
            style={{
              position: 'relative',
              width: 140,
              aspectRatio: numericRatio,
              borderRadius: palette.radiusSm,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: item.error ? palette.danger : palette.border,
              backgroundColor: palette.placeholderBg,
            }}
          >
            {item.data && !item.isUploading ? (
              <AnimatedImage
                image={item.data}
                aspectRatio={props.aspectRatio ?? '1:1'}
                reduceMotion={props.reduceMotion}
              />
            ) : (
              <NativeImage
                data-slot="tile-optimistic-preview"
                source={{ uri: item.uri }}
                alt={`Upload ${index + 1}`}
                resizeMode="cover"
                style={{ width: '100%', height: '100%', opacity: item.isUploading ? 0.6 : 1 }}
              />
            )}

            {showCoverBadge && index === 0 ? (
              <NativeView
                data-slot="cover-badge"
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  backgroundColor: palette.primary,
                  borderRadius: palette.radiusSm,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                }}
              >
                <NativeText style={{ color: '#ffffff', fontSize: 11 }}>{t.cover}</NativeText>
              </NativeView>
            ) : null}

            {item.isUploading ? (
              <NativeView
                data-slot="tile-progress"
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: 6,
                  right: 6,
                  backgroundColor: palette.bg,
                  borderRadius: palette.radiusSm,
                  padding: 4,
                }}
              >
                <NativeText style={{ color: palette.text, fontSize: 11 }}>{`${item.progress}%`}</NativeText>
                <NativePressable
                  data-slot="tile-cancel"
                  accessibilityLabel={t.cancel}
                  onPress={() => cancelItem(item.id)}
                >
                  <NativeText style={{ color: palette.danger, fontSize: 11 }}>{t.cancel}</NativeText>
                </NativePressable>
              </NativeView>
            ) : null}

            {item.error ? (
              <NativeView
                data-slot="tile-error"
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: 6,
                  right: 6,
                  backgroundColor: palette.dangerSoft,
                  borderRadius: palette.radiusSm,
                  padding: 4,
                }}
              >
                <NativeText style={{ color: palette.danger, fontSize: 11 }}>{item.error}</NativeText>
                <NativePressable
                  data-slot="tile-retry"
                  accessibilityLabel={t.retry}
                  onPress={() => void retryItem(item.id)}
                >
                  <NativeText style={{ color: palette.danger, fontSize: 11 }}>{t.retry}</NativeText>
                </NativePressable>
              </NativeView>
            ) : null}

            {!item.isUploading ? (
              <NativeView
                data-slot="tile-controls"
                style={{ position: 'absolute', bottom: 4, right: 4, flexDirection: 'row', gap: 4 }}
              >
                {reorderable && index > 0 ? (
                  <NativePressable
                    data-slot="tile-move-earlier"
                    accessibilityLabel={t.moveEarlier}
                    onPress={() => move(index, index - 1)}
                  >
                    <NativeText style={{ fontSize: 11 }}>←</NativeText>
                  </NativePressable>
                ) : null}
                {reorderable && index < items.length - 1 ? (
                  <NativePressable
                    data-slot="tile-move-later"
                    accessibilityLabel={t.moveLater}
                    onPress={() => move(index, index + 1)}
                  >
                    <NativeText style={{ fontSize: 11 }}>→</NativeText>
                  </NativePressable>
                ) : null}
                {reorderable && index > 0 ? (
                  <NativePressable
                    data-slot="tile-set-cover"
                    accessibilityLabel={t.setCover}
                    onPress={() => setCover(index)}
                  >
                    <NativeText style={{ fontSize: 11 }}>★</NativeText>
                  </NativePressable>
                ) : null}
                <NativePressable
                  data-slot="tile-remove"
                  accessibilityLabel={t.remove}
                  onPress={() => void removeItem(item.id)}
                >
                  <NativeText style={{ color: palette.danger, fontSize: 11 }}>{t.remove}</NativeText>
                </NativePressable>
              </NativeView>
            ) : null}
          </NativeView>
        ))}
      </NativeView>

      {canAddMore ? (
        <NativeView
          data-slot="multi-actions"
          style={{ flexDirection: 'row', gap: 8, marginTop: items.length > 0 ? 10 : 0 }}
        >
          <NativePressable
            data-slot="library-button"
            disabled={props.disabled}
            accessibilityLabel={t.addLibrary}
            onPress={() => void pickFromLibrary()}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              backgroundColor: palette.primary,
              borderRadius: palette.radiusSm,
            }}
          >
            <NativeText style={{ color: '#ffffff', fontSize: 13 }}>{t.addLibrary}</NativeText>
          </NativePressable>
          <NativePressable
            data-slot="camera-button"
            disabled={props.disabled}
            accessibilityLabel={t.takePhoto}
            onPress={() => void takePhoto()}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              backgroundColor: palette.surfaceHover,
              borderRadius: palette.radiusSm,
            }}
          >
            <NativeText style={{ color: palette.text, fontSize: 13 }}>{t.takePhoto}</NativeText>
          </NativePressable>
        </NativeView>
      ) : null}
    </NativeView>
  );
}

export default MultiImageUpload;
