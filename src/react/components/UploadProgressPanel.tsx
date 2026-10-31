import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { UploadLocale } from '../../types';
import { useImageUploadContext } from '../context';
import {
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';
import type { CustomImageRenderer } from '../types';
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
}

export function UploadProgressPanel({
  items,
  completedCount,
  totalCount,
  locale: propLocale,
  translations,
  renderImage,
}: UploadProgressPanelProps) {
  const ctx = useImageUploadContext();
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(locale, translations || ctx.translations);
  const [isMinimized, setIsMinimized] = useState(false);
  const uploadingCount = items.length;

  if (uploadingCount === 0) return null;

  return (
    <div
      data-upload-progress-dock
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className={`iuk-progress-dock ${isMinimized ? 'iuk-progress-dock--collapsed' : ''}`}
    >
      <div
        className={`iuk-progress-panel ${isMinimized ? 'iuk-progress-panel--minimized' : ''}`}
      >
        <button
          type="button"
          className="iuk-progress-panel__header"
          onClick={() => setIsMinimized((prev) => !prev)}
        >
          <span className="iuk-progress-panel__title">
            <Loader2 size={16} className="iuk-spin" />
            <span>
              {ui.uploading} {uploadingCount}{' '}
              {uploadingCount !== 1 ? ui.uploadImages : ui.uploadImage}
            </span>
            {totalCount > 0 && (
              <span className="iuk-progress-panel__count">
                ({completedCount}/{totalCount})
              </span>
            )}
          </span>
          {isMinimized ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {!isMinimized && (
          <div className="iuk-progress-panel__body">
            {items.map((item) => (
              <div key={item.id} className="iuk-progress-item">
                <div className="iuk-progress-item__thumb">
                  <BlurImage
                    src={item.url}
                    alt={ui.uploadingAlt}
                    objectFit="cover"
                    renderImage={renderImage}
                  />
                </div>
                <div className="iuk-progress-item__info">
                  <div className="iuk-progress-item__name">
                    {item.fileName || ui.image}
                  </div>
                  <div className="iuk-progress-item__status">
                    {item.message || ui.processing}
                  </div>
                  {item.progress !== undefined && item.progress > 0 && (
                    <div className="iuk-progress-bar">
                      <div
                        className="iuk-progress-bar__fill"
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
