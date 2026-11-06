import {
  ChevronUpIcon as ChevronUp,
  LoaderIcon as Loader2,
  MinusIcon as Minus,
  XIcon as X,
} from '../icons';
import {
  type ForwardedRef,
  forwardRef,
  type ReactElement,
  type Ref,
  useEffect,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { UploadPresetName } from '../../types';
import { useImageUploadContext } from '../context';
import { useDialog } from '../hooks/useDialog';
import { normalizeUploadLocale, resolveTranslations } from '../i18n';
import type {
  ImageUploadHandle,
  ImageUploadProps,
  MultiImageUploadProps,
  SingleImageUploadProps,
} from '../types';
import { resolveSlotClass } from '../utils/slotStyles';
import { MultiImageUpload } from './MultiImageUpload';
import { SingleImageUpload } from './SingleImageUpload';

function ImageUploadInner<TPreset extends string = UploadPresetName>(
  props: ImageUploadProps<TPreset>,
  ref: ForwardedRef<ImageUploadHandle>,
) {
  const ctx = useImageUploadContext();
  const isUnstyled = props.unstyled ?? ctx.unstyled;
  const uploadLocale = normalizeUploadLocale(props.locale || ctx.locale);
  const ui = resolveTranslations(
    uploadLocale,
    props.translations || ctx.translations,
  );
  const dir = uploadLocale === 'ar' ? 'rtl' : 'ltr';
  const { isOpen, onClose, title, modeVariant } = props;
  const [isMinimized, setIsMinimized] = useState(false);
  const [dockNode, setDockNode] = useState<HTMLElement | null>(null);
  const cls = (defaultClass: string) => resolveSlotClass(defaultClass, isUnstyled);

  useEffect(() => {
    if (!isOpen) {
      setIsMinimized(false);
    }
  }, [isOpen]);

  const { dialogRef, titleId } = useDialog({
    isOpen: Boolean(isOpen) && !isMinimized,
    onClose,
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen || !isMinimized) {
      setDockNode(null);
      return;
    }

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
  }, [isOpen, isMinimized]);

  const content =
    props.mode === 'multiple' ? (
      <MultiImageUpload ref={ref} {...(props as MultiImageUploadProps<TPreset>)} />
    ) : (
      <SingleImageUpload ref={ref} {...(props as SingleImageUploadProps<TPreset>)} />
    );

  if (isOpen === undefined) {
    return (
      <div
        data-slot="upload-root"
        data-unstyled={isUnstyled || undefined}
        className={cls('iuk-root')}
        dir={dir}
        data-upload-locale={uploadLocale}
      >
        {content}
      </div>
    );
  }

  if (!isOpen) return null;

  const minimizedButton = (
    <button
      type="button"
      data-slot="minimized-pill"
      className={cls('iuk-minimized-pill')}
      onClick={() => setIsMinimized(false)}
      title={ui.restoreUploadWindow}
    >
      <Loader2 size={16} className={cls('iuk-spin')} />
      <span className={cls('iuk-minimized-pill__copy')}>
        <span className={cls('iuk-minimized-pill__primary')}>{ui.uploadWindow}</span>
        <span className={cls('iuk-minimized-pill__secondary')}>{ui.tapToResume}</span>
      </span>
      <ChevronUp size={16} />
    </button>
  );

  return (
    <>
      <div
        data-slot="upload-modal-backdrop"
        data-unstyled={isUnstyled || undefined}
        className={cls(
          `iuk-root iuk-modal-backdrop ${isMinimized ? 'iuk-modal-backdrop--hidden' : ''}`.trim(),
        )}
        dir={dir}
        data-upload-locale={uploadLocale}
        role="dialog"
        aria-modal={!isMinimized}
        aria-hidden={isMinimized}
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ui.uploadWindow : undefined}
        onClick={() => onClose?.()}
      >
        <div
          ref={dialogRef}
          data-slot="upload-dialog"
          className={cls(
            `iuk-upload-dialog ${isMinimized ? 'iuk-upload-dialog--hidden' : ''}`.trim(),
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {onClose && (
            <div className={cls('iuk-upload-dialog__controls')}>
              <button
                type="button"
                className={cls('iuk-icon-btn iuk-icon-btn--floating')}
                onClick={() => setIsMinimized(true)}
                aria-label={ui.minimize}
                title={ui.minimizeUploader}
              >
                <Minus size={18} />
              </button>
              <button
                type="button"
                className={cls('iuk-icon-btn iuk-icon-btn--floating')}
                onClick={onClose}
                aria-label={ui.close}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div
            className={cls('iuk-upload-dialog__card')}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <h3 id={titleId} className={cls('iuk-upload-dialog__title')}>
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
            <div className={cls('iuk-minimized-portal')}>{minimizedButton}</div>,
            dockNode,
          )
        ) : (
          <div className={cls('iuk-minimized-dock')}>{minimizedButton}</div>
        ))}
    </>
  );
}

export const ImageUpload = forwardRef(ImageUploadInner) as <
  TPreset extends string = UploadPresetName,
>(
  props: ImageUploadProps<TPreset> & { ref?: Ref<ImageUploadHandle> },
) => ReactElement | null;

export const UnifiedImageUpload = ImageUpload;
export default ImageUpload;
