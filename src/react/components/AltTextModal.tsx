import { CheckCircleIcon as CheckCircle2, TypeIcon, XIcon as X } from '../icons';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UploadLocale } from '../../types';
import { useImageUploadContext } from '../context';
import { useDialog } from '../hooks/useDialog';
import {
  normalizeUploadLocale,
  resolveTranslations,
  type UploadTranslations,
} from '../i18n';
import type { CustomImageRenderer } from '../types';
import { resolveSlotClass } from '../utils/slotStyles';
import { BlurImage } from './BlurImage';

export interface AltTextModalProps {
  imageUrl: string;
  initialAltText?: string;
  onSave: (altText: string) => void;
  onClose: () => void;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  renderImage?: CustomImageRenderer;
  unstyled?: boolean;
}

export function AltTextModal({
  imageUrl,
  initialAltText = '',
  onSave,
  onClose,
  locale: propLocale,
  translations,
  renderImage,
  unstyled: propUnstyled,
}: AltTextModalProps) {
  const ctx = useImageUploadContext();
  const isUnstyled = propUnstyled ?? ctx.unstyled;
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const ui = resolveTranslations(locale, translations || ctx.translations);
  const [localAltText, setLocalAltText] = useState(initialAltText);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { dialogRef, titleId, descriptionId } = useDialog({
    isOpen: true,
    onClose,
    initialFocusRef: inputRef,
  });
  const cls = (defaultClass: string) => resolveSlotClass(defaultClass, isUnstyled);

  const handleSave = () => {
    onSave(localAltText);
    onClose();
  };

  const content = (
    <div
      data-slot="alt-modal-backdrop"
      data-unstyled={isUnstyled || undefined}
      className={cls('iuk-modal-backdrop')}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div
        ref={dialogRef}
        data-slot="alt-modal"
        className={cls('iuk-alt-modal')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cls('iuk-alt-modal__header')}>
          <div className={cls('iuk-alt-modal__title')}>
            <TypeIcon size={18} />
            <span id={titleId}>{ui.addImageDescription}</span>
          </div>
          <button
            type="button"
            className={cls('iuk-icon-btn')}
            onClick={onClose}
            title={ui.close}
            aria-label={ui.close}
          >
            <X size={18} />
          </button>
        </div>

        <div className={cls('iuk-alt-modal__preview')}>
          <BlurImage
            src={imageUrl}
            alt={ui.previewAlt}
            objectFit="contain"
            renderImage={renderImage}
          />
        </div>

        <input
          ref={inputRef}
          type="text"
          className={cls('iuk-alt-input__field')}
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
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        />

        <div id={descriptionId} className={cls('iuk-alt-input__hint')}>
          <span>
            {localAltText.length}/200 {ui.characters}
          </span>
          <span>{ui.usedForA11ySeo}</span>
        </div>

        <div className={cls('iuk-alt-modal__actions')}>
          <button
            type="button"
            className={cls('iuk-btn iuk-btn--secondary')}
            onClick={onClose}
          >
            {ui.cancel}
          </button>
          <button
            type="button"
            className={cls('iuk-btn iuk-btn--primary')}
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
