import { type CSSProperties, type KeyboardEvent, useMemo, useState } from 'react';
import type { BlurPlaceholderType } from '../../blur/types';
import type { UploadLocale } from '../../types';
import { useImageUploadContext } from '../context';
import { useBlurDataURL } from '../hooks/useBlurService';
import {
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';
import type { CustomImageRenderer, ImagePreview } from '../types';
import { appendCacheBuster } from '../utils/sessionMetaCache';
import { cx, resolveSlotClass, resolveUploadDataState } from '../utils/slotStyles';
import { BlurImage } from './BlurImage';
import { BlurVisualizationModal } from './BlurVisualizationModal';
import { PreviewTileActions } from './PreviewTileActions';

export interface PreviewTileProps {
  preview: ImagePreview;
  onRemove: (id: string) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  disabled?: boolean;
  blurType?: BlurPlaceholderType;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onEditAltText?: (id: string) => void;
  showCheckbox?: boolean;
  index?: number;
  totalCount?: number;
  reorderable?: boolean;
  showCoverBadge?: boolean;
  onMove?: (fromIndex: number, toIndex: number) => void;
  onSetCover?: (index: number) => void;
  onAdjustColor?: (id: string) => void;
  onChangeColor?: (id: string, color: string) => void;
  onChangeAltText?: (id: string, altText: string) => void;
  appendCacheBuster?: boolean;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  renderImage?: CustomImageRenderer;
  unstyled?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function PreviewTile({
  preview,
  onRemove,
  onCancel,
  onRetry,
  disabled = false,
  blurType = 'card',
  isSelected = false,
  onToggleSelect,
  onEditAltText,
  showCheckbox = true,
  index = 0,
  totalCount = 1,
  reorderable = false,
  showCoverBadge = false,
  onMove,
  onSetCover,
  onAdjustColor,
  onChangeColor,
  onChangeAltText,
  appendCacheBuster: appendBuster = false,
  locale: propLocale,
  translations,
  renderImage,
  unstyled: propUnstyled,
  className,
  style,
}: PreviewTileProps) {
  const ctx = useImageUploadContext();
  const isUnstyled = propUnstyled ?? ctx.unstyled;
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(locale, translations || ctx.translations);
  const [showBlurModal, setShowBlurModal] = useState(false);
  const cls = (defaultClass: string) => resolveSlotClass(defaultClass, isUnstyled);

  const isSvg = Boolean(
    preview.url?.toLowerCase().includes('.svg') ||
      preview.data?.format === 'svg' ||
      preview.url?.includes('image/svg+xml'),
  );

  const displayUrl = useMemo(
    () =>
      appendCacheBuster(preview.url, {
        enabled: appendBuster,
        token: preview.data?.contentHash || preview.data?.uploadedAt,
      }),
    [preview.url, preview.data?.contentHash, preview.data?.uploadedAt, appendBuster],
  );

  const fallbackBlurDataURL = useBlurDataURL(preview.url, { type: blurType, size: 'small' });
  const actualBlurDataUrl = preview.data?.blurDataUrl || fallbackBlurDataURL;
  const actualBlurColor = preview.blurColor || preview.data?.blurColor;

  const isUploading = Boolean(preview.isUploading);
  const hasError = Boolean(preview.error);
  const visualState = resolveUploadDataState({
    disabled,
    hasError,
    isUploading,
    hasContent: true,
  });
  const isSuccess = Boolean(
    !isUploading && !hasError && preview.originalSize && preview.optimizedSize,
  );
  const reductionPercent =
    isSuccess && preview.originalSize && preview.optimizedSize
      ? Math.round(
          ((preview.originalSize - preview.optimizedSize) / preview.originalSize) * 100,
        )
      : 0;

  const handleTileKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      reorderable &&
      !disabled &&
      !isUploading &&
      !hasError &&
      totalCount > 1 &&
      event.altKey
    ) {
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        onMove?.(index, index - 1);
      } else if (event.key === 'ArrowRight' && index < totalCount - 1) {
        event.preventDefault();
        onMove?.(index, index + 1);
      }
    }
  };

  return (
    <div
      data-slot="tile"
      data-index={index}
      data-state={visualState}
      data-selected={isSelected || undefined}
      data-uploading={isUploading || undefined}
      data-error={hasError || undefined}
      data-cover={(showCoverBadge && index === 0 && !hasError) || undefined}
      tabIndex={reorderable && !disabled ? 0 : undefined}
      className={resolveSlotClass(
        cx('iuk-tile', isSelected && 'iuk-tile--selected', hasError && 'iuk-tile--error'),
        isUnstyled,
        className,
      )}
      style={style}
      onClick={() => onToggleSelect && !disabled && onToggleSelect(preview.id)}
      onKeyDown={handleTileKeyDown}
    >
      <div data-slot="tile-media" className={cls('iuk-tile__media')}>
        <BlurImage
          src={displayUrl}
          alt={preview.altText || ui.previewAlt}
          blurDataUrl={!isSvg ? actualBlurDataUrl : undefined}
          blurColor={actualBlurColor}
          blurHash={preview.data?.blurHash}
          objectFit={isSvg ? 'contain' : 'cover'}
          style={isSvg ? { padding: '8px' } : undefined}
          renderImage={renderImage}
        />

        <PreviewTileActions
          preview={preview}
          ui={ui}
          isUnstyled={isUnstyled}
          disabled={disabled}
          isUploading={isUploading}
          hasError={hasError}
          isSuccess={isSuccess}
          reductionPercent={reductionPercent}
          actualBlurColor={actualBlurColor}
          showCheckbox={showCheckbox}
          isSelected={isSelected}
          index={index}
          totalCount={totalCount}
          reorderable={reorderable}
          showCoverBadge={showCoverBadge}
          onToggleSelect={onToggleSelect}
          onEditAltText={onEditAltText}
          onOpenBlurInspector={() => {
            if (onAdjustColor) onAdjustColor(preview.id);
            else setShowBlurModal(true);
          }}
          onRemove={onRemove}
          onCancel={onCancel}
          onRetry={onRetry}
          onMove={onMove}
          onSetCover={onSetCover}
        />
      </div>

      <BlurVisualizationModal
        isOpen={showBlurModal}
        onClose={() => setShowBlurModal(false)}
        imageUrl={preview.url}
        blurDataUrl={actualBlurDataUrl}
        blurColor={actualBlurColor}
        detectedColor={preview.data?.blurColor}
        altText={preview.altText}
        originalSize={preview.originalSize}
        optimizedSize={preview.optimizedSize}
        locale={locale}
        translations={translations}
        renderImage={renderImage}
        unstyled={isUnstyled}
        onChangeColor={(hex) => onChangeColor?.(preview.id, hex)}
        onUseDetectedColor={
          onChangeColor && preview.data?.blurColor
            ? () => onChangeColor(preview.id, preview.data!.blurColor!)
            : undefined
        }
        onChangeAltText={(nextAlt) => onChangeAltText?.(preview.id, nextAlt)}
      />
    </div>
  );
}

export default PreviewTile;
