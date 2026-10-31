import { ChevronUp, Loader2, Minus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UploadPresetName } from '../../types';
import { useImageUploadContext } from '../context';
import { normalizeUploadLocale, resolveTranslations } from '../i18n';
import type {
  ImageUploadProps,
  MultiImageUploadProps,
  SingleImageUploadProps,
} from '../types';
import { MultiImageUpload } from './MultiImageUpload';
import { SingleImageUpload } from './SingleImageUpload';

export function ImageUpload<TPreset extends string = UploadPresetName>(
  props: ImageUploadProps<TPreset>,
) {
  const ctx = useImageUploadContext();
  const uploadLocale = normalizeUploadLocale(props.locale || ctx.locale);
  const ui = resolveTranslations(
    uploadLocale,
    props.translations || ctx.translations,
  );
  const dir = uploadLocale === 'ar' ? 'rtl' : 'ltr';
  const { isOpen, onClose, title, modeVariant } = props;
  const [isMinimized, setIsMinimized] = useState(false);
  const [dockNode, setDockNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateDockReference = () => {
      const node = document.querySelector('[data-upload-progress-dock]');
      setDockNode((prev) =>
        node instanceof HTMLElement ? (node === prev ? prev : node) : null,
      );
    };

    updateDockReference();

    const observer = new MutationObserver(() => updateDockReference());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  const content =
    props.mode === 'multiple' ? (
      <MultiImageUpload {...(props as MultiImageUploadProps<TPreset>)} />
    ) : (
      <SingleImageUpload {...(props as SingleImageUploadProps<TPreset>)} />
    );

  if (isOpen === undefined) {
    return (
      <div className="iuk-root" dir={dir} data-upload-locale={uploadLocale}>
        {content}
      </div>
    );
  }

  if (!isOpen) return null;

  const minimizedButton = (
    <button
      type="button"
      className="iuk-minimized-pill"
      onClick={() => setIsMinimized(false)}
      title={ui.restoreUploadWindow}
    >
      <Loader2 size={16} className="iuk-spin" />
      <span className="iuk-minimized-pill__copy">
        <span className="iuk-minimized-pill__primary">{ui.uploadWindow}</span>
        <span className="iuk-minimized-pill__secondary">{ui.tapToResume}</span>
      </span>
      <ChevronUp size={16} />
    </button>
  );

  return (
    <>
      <div
        className={`iuk-root iuk-modal-backdrop ${isMinimized ? 'iuk-modal-backdrop--hidden' : ''}`}
        dir={dir}
        data-upload-locale={uploadLocale}
        role="dialog"
        aria-modal={!isMinimized}
        aria-hidden={isMinimized}
      >
        <div
          className={`iuk-upload-dialog ${isMinimized ? 'iuk-upload-dialog--hidden' : ''}`}
        >
          {onClose && (
            <div className="iuk-upload-dialog__controls">
              <button
                type="button"
                className="iuk-icon-btn iuk-icon-btn--floating"
                onClick={() => setIsMinimized(true)}
                aria-label={ui.minimize}
                title={ui.minimizeUploader}
              >
                <Minus size={18} />
              </button>
              <button
                type="button"
                className="iuk-icon-btn iuk-icon-btn--floating"
                onClick={onClose}
                aria-label={ui.close}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div
            className="iuk-upload-dialog__card"
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <h3 className="iuk-upload-dialog__title">
                {modeVariant === 'edit'
                  ? ui.editPrefix.replace('{title}', title)
                  : title}
              </h3>
            )}
            {content}
          </div>
        </div>
      </div>

      {isMinimized &&
        typeof document !== 'undefined' &&
        (dockNode ? (
          createPortal(
            <div className="iuk-minimized-portal">{minimizedButton}</div>,
            dockNode,
          )
        ) : (
          <div className="iuk-minimized-dock">{minimizedButton}</div>
        ))}
    </>
  );
}

export const UnifiedImageUpload = ImageUpload;
export default ImageUpload;
