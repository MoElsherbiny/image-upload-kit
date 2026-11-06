import { CheckCircleIcon as CheckCircle2, TypeIcon, XIcon as X } from '../icons';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { UploadLocale } from '../../types';
import { useImageUploadContext } from '../context';
import {
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';
import type { CustomImageRenderer } from '../types';
import { BlurImage } from './BlurImage';

export interface AltTextModalProps {
  imageUrl: string;
  initialAltText?: string;
  onSave: (altText: string) => void;
  onClose: () => void;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  renderImage?: CustomImageRenderer;
}

export function AltTextModal({
  imageUrl,
  initialAltText = '',
  onSave,
  onClose,
  locale: propLocale,
  translations,
  renderImage,
}: AltTextModalProps) {
  const ctx = useImageUploadContext();
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(locale, translations || ctx.translations);
  const [localAltText, setLocalAltText] = useState(initialAltText);

  const handleSave = () => {
    onSave(localAltText);
    onClose();
  };

  const content = (
    <div
      className="iuk-modal-backdrop"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="iuk-alt-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="iuk-alt-modal__header">
          <div className="iuk-alt-modal__title">
            <TypeIcon size={18} />
            <span>{ui.addImageDescription}</span>
          </div>
          <button
            type="button"
            className="iuk-icon-btn"
            onClick={onClose}
            title={ui.close}
            aria-label={ui.close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="iuk-alt-modal__preview">
          <BlurImage
            src={imageUrl}
            alt={ui.previewAlt}
            objectFit="contain"
            renderImage={renderImage}
          />
        </div>

        <input
          type="text"
          className="iuk-alt-input__field"
          value={localAltText}
          onChange={(e) => setLocalAltText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSave();
            }
          }}
          placeholder={ui.describeImagePlaceholder}
          maxLength={200}
          autoFocus
        />

        <div className="iuk-alt-input__hint">
          <span>
            {localAltText.length}/200 {ui.characters}
          </span>
          <span>{ui.usedForA11ySeo}</span>
        </div>

        <div className="iuk-alt-modal__actions">
          <button
            type="button"
            className="iuk-btn iuk-btn--secondary"
            onClick={onClose}
          >
            {ui.cancel}
          </button>
          <button
            type="button"
            className="iuk-btn iuk-btn--primary"
            onClick={handleSave}
          >
            <CheckCircle2 size={16} />
            <span>{ui.saveDescription}</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return content;
}

export default AltTextModal;
