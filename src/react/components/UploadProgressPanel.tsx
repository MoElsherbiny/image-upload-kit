import {
  ChevronDownIcon as ChevronDown,
  ChevronUpIcon as ChevronUp,
  LoaderIcon as Loader2,
} from '../icons';
import { useState } from 'react';
import type { UploadLocale } from '../../types';
import { useImageUploadContext } from '../context';
import {
  formatUploadingCount,
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';
import type { CustomImageRenderer } from '../types';
import { cx, resolveSlotClass } from '../utils/slotStyles';
import { BlurImage } from './BlurImage';

export interface UploadItem {
  id: string;
  url: string;
  fileName?: string;
  message?: string;
  progress?: number;
}

export interface UploadProgressPanelProps {
  items: UploadItem[];
  completedCount: number;
  totalCount: number;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  renderImage?: CustomImageRenderer;
  unstyled?: boolean;
}

export function UploadProgressPanel({
  items,
  completedCount,
  totalCount,
  locale: propLocale,
  translations,
  renderImage,
  unstyled: propUnstyled,
}: UploadProgressPanelProps) {
  const ctx = useImageUploadContext();
  const isUnstyled = propUnstyled ?? ctx.unstyled;
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const effectiveOverrides = translations || ctx.translations;
  const ui = resolveTranslations(locale, effectiveOverrides);
  const [isMinimized, setIsMinimized] = useState(false);
  const uploadingCount = items.length;
  const cls = (defaultClass: string) => resolveSlotClass(defaultClass, isUnstyled);

  if (uploadingCount === 0) return null;

  return (
    <div
      data-upload-progress-dock
      data-slot="progress-dock"
      data-unstyled={isUnstyled || undefined}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className={cls(
        cx('iuk-progress-dock', isMinimized && 'iuk-progress-dock--collapsed'),
      )}
    >
      <div
        className={cls(
          cx('iuk-progress-panel', isMinimized && 'iuk-progress-panel--minimized'),
        )}
      >
        <button
          type="button"
          className={cls('iuk-progress-panel__header')}
          aria-expanded={!isMinimized}
          onClick={() => setIsMinimized((prev) => !prev)}
        >
          <span className={cls('iuk-progress-panel__title')}>
            <Loader2 size={16} className={cls('iuk-spin')} />
            <span>
              {formatUploadingCount(ui, uploadingCount, locale, effectiveOverrides)}
            </span>
            {totalCount > 0 && (
              <span className={cls('iuk-progress-panel__count')}>
                ({completedCount}/{totalCount})
              </span>
            )}
          </span>
          {isMinimized ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {!isMinimized && (
          <div className={cls('iuk-progress-panel__body')}>
            {items.map((item) => (
              <div key={item.id} className={cls('iuk-progress-item')}>
                <div className={cls('iuk-progress-item__thumb')}>
                  <BlurImage
                    src={item.url}
                    alt={ui.uploadingAlt}
                    objectFit="cover"
                    renderImage={renderImage}
                  />
                </div>
                <div className={cls('iuk-progress-item__info')}>
                  <div className={cls('iuk-progress-item__name')}>
                    {item.fileName || ui.image}
                  </div>
                  <div className={cls('iuk-progress-item__status')}>
                    {item.message || ui.processing}
                  </div>
                  {item.progress !== undefined && item.progress > 0 && (
                    <div
                      role="progressbar"
                      aria-valuenow={Math.round(item.progress)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={item.fileName || ui.uploading}
                      className={cls('iuk-progress-bar')}
                    >
                      <div
                        className={cls('iuk-progress-bar__fill')}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadProgressPanel;
