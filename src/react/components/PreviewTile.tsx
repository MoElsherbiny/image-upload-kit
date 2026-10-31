import {
  CheckCircle2,
  Loader2,
  Palette,
  Type as TypeIcon,
  X,
  XCircle,
} from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
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
import { cx, resolveSlotClass } from '../utils/slotStyles';
import { BlurImage } from './BlurImage';
import { BlurVisualizationModal } from './BlurVisualizationModal';

export interface PreviewTileProps {
  preview: ImagePreview;
  onRemove: (id: string) => void;
  disabled?: boolean;
  blurType?: BlurPlaceholderType;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onEditAltText?: (id: string) => void;
  showCheckbox?: boolean;
  onAdjustColor?: (id: string) => void;
  onChangeColor?: (id: string, color: string) => void;
  onChangeAltText?: (id: string, altText: string) => void;
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
  disabled = false,
  blurType = 'card',
  isSelected = false,
  onToggleSelect,
  onEditAltText,
  showCheckbox = true,
  onAdjustColor,
  onChangeColor,
  onChangeAltText,
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

  const [sessionBuster] = useState(() => Date.now());

  const displayUrl = useMemo(() => {
    const url = preview.url;
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
    if (url.includes('?v=') || url.includes('&v=') || url.includes('?t=') || url.includes('&t=')) {
      return url;
    }
    const buster = preview.data?.contentHash || preview.data?.uploadedAt || sessionBuster;
    return `${url}${url.includes('?') ? '&' : '?'}t=${buster}`;
  }, [preview.url, preview.data?.contentHash, preview.data?.uploadedAt, sessionBuster]);

  const fallbackBlurDataURL = useBlurDataURL(preview.url, {
    type: blurType,
    size: 'small',
  });

  const actualBlurDataUrl = preview.data?.blurDataUrl || fallbackBlurDataURL;
  const actualBlurColor = preview.blurColor || preview.data?.blurColor;

  const isUploading = Boolean(preview.isUploading);
  const hasError = Boolean(preview.error);
  const isSuccess = Boolean(
    !isUploading && !hasError && preview.originalSize && preview.optimizedSize,
  );

  const reductionPercent =
    isSuccess && preview.originalSize && preview.optimizedSize
      ? Math.round(
          ((preview.originalSize - preview.optimizedSize) / preview.originalSize) * 100,
        )
      : 0;

  return (
    <div
      data-slot="tile"
      data-selected={isSelected || undefined}
      data-uploading={isUploading || undefined}
      data-error={hasError || undefined}
      className={resolveSlotClass(
        cx(
          'iuk-tile',
          isSelected && 'iuk-tile--selected',
          hasError && 'iuk-tile--error',
        ),
        isUnstyled,
        className,
      )}
      style={style}
      onClick={() => onToggleSelect && !disabled && onToggleSelect(preview.id)}
    >
      <div className={cls('iuk-tile__media')}>
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

        {showCheckbox && !disabled && !isUploading && onToggleSelect && (
          <div
            className={cls('iuk-tile__checkbox')}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(preview.id)}
              aria-label={ui.selectImageAria}
            />
          </div>
        )}

        {!disabled && onEditAltText && (
          <button
            type="button"
            className={cls(
              cx(
                'iuk-tile__action iuk-tile__action--alt',
                Boolean(preview.altText) && 'iuk-tile__action--has-alt',
              ),
            )}
            onClick={(e) => {
              e.stopPropagation();
              onEditAltText(preview.id);
            }}
            aria-label={preview.altText ? ui.editAltTextAria : ui.addAltTextAria}
            title={
              preview.altText
                ? ui.editPrefix.replace('{title}', preview.altText)
                : ui.addDescriptionForA11y
            }
          >
            {preview.altText ? <CheckCircle2 size={14} /> : <TypeIcon size={14} />}
          </button>
        )}

        {!disabled && !isUploading && (
          <button
            type="button"
            className={cls('iuk-tile__action iuk-tile__action--blur')}
            onClick={(e) => {
              e.stopPropagation();
              if (onAdjustColor) onAdjustColor(preview.id);
              else setShowBlurModal(true);
            }}
            aria-label={ui.adjustBlurColorAria}
            title={ui.adjustBlurColorTitle}
          >
            <Palette size={14} />
          </button>
        )}

        {!disabled && !isUploading && (
          <button
            type="button"
            className={cls('iuk-tile__action iuk-tile__action--remove')}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(preview.id);
            }}
            aria-label={ui.removeImageAria}
          >
            <X size={15} />
          </button>
        )}

        {isUploading && (
          <div className={cls('iuk-tile__overlay')}>
            <Loader2 size={24} className={cls('iuk-spin')} />
            <p className={cls('iuk-tile__status')}>
              {preview.uploadMessage || `${ui.uploading}...`}
            </p>
            {preview.progress !== undefined && preview.progress > 0 && (
              <div className={cls('iuk-progress-bar')}>
                <div
                  className={cls('iuk-progress-bar__fill')}
                  style={{ width: `${preview.progress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {isSuccess && (
          <div className={cls('iuk-tile__badge iuk-tile__badge--success')}>
            <CheckCircle2 size={13} />
            {reductionPercent > 0 && <span>-{reductionPercent}%</span>}
          </div>
        )}

        {!disabled && !isUploading && !hasError && actualBlurColor && (
          <div className={cls('iuk-tile__badge iuk-tile__badge--color')}>
            <span
              className={cls('iuk-tile__color-dot')}
              style={{ backgroundColor: actualBlurColor }}
            />
            <code>{actualBlurColor.toUpperCase()}</code>
          </div>
        )}

        {hasError && (
          <div className={cls('iuk-tile__overlay iuk-tile__overlay--error')}>
            <XCircle size={22} />
            <p>{preview.error}</p>
          </div>
        )}
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
        onChangeColor={(hex) => onChangeColor?.(preview.id, hex)}
        onChangeAltText={(nextAlt) => onChangeAltText?.(preview.id, nextAlt)}
      />
    </div>
  );
}

export default PreviewTile;
