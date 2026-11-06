import { EyeIcon as Eye, XIcon as X } from '../icons';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UploadLocale } from '../../types';
import { normalizeColorInput } from '../../utils/color';
import { formatFileSize } from '../../utils/formatters';
import { useImageUploadContext } from '../context';
import { useDialog } from '../hooks/useDialog';
import { normalizeUploadLocale, resolveTranslations, type UploadTranslations } from '../i18n';
import type { CustomImageRenderer } from '../types';
import { drawImageToCanvas, sampleCanvasPixelHex } from '../utils/canvasSampler';
import { resolveSlotClass } from '../utils/slotStyles';
import { BlurColorControls } from './BlurColorControls';
import { BlurImage } from './BlurImage';
import { SaveButton } from './SaveButton';

const DEBOUNCE_MS = 250;

export interface BlurVisualizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  blurDataUrl?: string;
  blurColor?: string;
  altText?: string;
  originalSize?: number;
  optimizedSize?: number | null;
  detectedColor?: string;
  onChangeColor?: (hex: string) => void;
  onUseDetectedColor?: () => void;
  onChangeAltText?: (altText: string) => void;
  locale?: UploadLocale;
  translations?: Partial<UploadTranslations>;
  renderImage?: CustomImageRenderer;
  unstyled?: boolean;
}

export function BlurVisualizationModal({
  isOpen, onClose, imageUrl, blurDataUrl, blurColor, altText,
  originalSize, optimizedSize, detectedColor, onChangeColor,
  onUseDetectedColor, onChangeAltText, locale: propLocale,
  translations, renderImage, unstyled: propUnstyled,
}: BlurVisualizationModalProps) {
  const ctx = useImageUploadContext();
  const isUnstyled = propUnstyled ?? ctx.unstyled;
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const tModal = resolveTranslations(locale, translations || ctx.translations).blurModal;
  const cls = (defaultClass: string) => resolveSlotClass(defaultClass, isUnstyled);

  const { dialogRef, titleId } = useDialog({ isOpen, onClose });
  const textareaId = useId();

  const baseColor = useMemo(() => (blurColor || detectedColor || '#F5F5F5').toUpperCase(), [blurColor, detectedColor]);
  const [localColor, setLocalColor] = useState(baseColor);
  const [hexInput, setHexInput] = useState(baseColor.replace('#', ''));
  const [sampledColor, setSampledColor] = useState<string | null>(null);
  const [penModeActive, setPenModeActive] = useState(false);
  const [localAltText, setLocalAltText] = useState(altText || '');
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const altTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingColorRef = useRef<string | null>(null);
  const pendingAltRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLocalColor(baseColor);
    setHexInput(baseColor.replace('#', ''));
    setLocalAltText(altText || '');
  }, [isOpen, baseColor, altText, blurDataUrl, imageUrl, blurColor]);

  useEffect(() => () => {
    if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
    if (altTimerRef.current) clearTimeout(altTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const srcToLoad = imageUrl || blurDataUrl;
    if (!srcToLoad) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => drawImageToCanvas(img, liveCanvasRef);
    img.onerror = () => {
      if (blurDataUrl && srcToLoad !== blurDataUrl) {
        const fallbackImg = new window.Image();
        fallbackImg.onload = () => drawImageToCanvas(fallbackImg, liveCanvasRef);
        fallbackImg.src = blurDataUrl;
      }
    };
    img.src = srcToLoad;
    return () => { img.onload = null; img.onerror = null; };
  }, [imageUrl, blurDataUrl, isOpen]);

  useEffect(() => {
    if (!sampledColor) return;
    const timer = window.setTimeout(() => setSampledColor(null), 2000);
    return () => window.clearTimeout(timer);
  }, [sampledColor]);

  if (!isOpen || typeof document === 'undefined') return null;

  const scheduleColorEmit = (hex: string) => {
    pendingColorRef.current = hex;
    if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
    colorTimerRef.current = setTimeout(() => {
      colorTimerRef.current = null;
      const next = pendingColorRef.current;
      pendingColorRef.current = null;
      if (next !== null) onChangeColor?.(next);
    }, DEBOUNCE_MS);
  };

  const scheduleAltEmit = (nextAlt: string) => {
    pendingAltRef.current = nextAlt;
    if (altTimerRef.current) clearTimeout(altTimerRef.current);
    altTimerRef.current = setTimeout(() => {
      altTimerRef.current = null;
      const next = pendingAltRef.current;
      pendingAltRef.current = null;
      if (next !== null) onChangeAltText?.(next);
    }, DEBOUNCE_MS);
  };

  const flushPendingChanges = () => {
    if (colorTimerRef.current) {
      clearTimeout(colorTimerRef.current);
      colorTimerRef.current = null;
    }
    if (pendingColorRef.current !== null) {
      onChangeColor?.(pendingColorRef.current);
      pendingColorRef.current = null;
    }
    if (altTimerRef.current) {
      clearTimeout(altTimerRef.current);
      altTimerRef.current = null;
    }
    if (pendingAltRef.current !== null) {
      onChangeAltText?.(pendingAltRef.current);
      pendingAltRef.current = null;
    }
  };

  const handleClose = () => {
    flushPendingChanges();
    onClose();
  };

  const syncLocalHex = (hex: string, notify = true) => {
    setLocalColor(hex);
    setHexInput(hex.replace('#', ''));
    if (notify) scheduleColorEmit(hex);
  };

  const handleColorPickerChange = (e: ChangeEvent<HTMLInputElement>) => syncLocalHex(e.target.value.toUpperCase());

  const handleHexInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexInput(sanitized.toUpperCase());
    if (sanitized.length === 3 || sanitized.length === 6) {
      const normalized = normalizeColorInput(`#${sanitized}`);
      if (normalized) {
        setLocalColor(normalized);
        scheduleColorEmit(normalized);
      }
    }
  };

  const handlePenSample = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!penModeActive) {
      if (event.pointerType === 'pen') setPenModeActive(true);
      else return;
    }
    const sampled = sampleCanvasPixelHex(event, liveCanvasRef);
    if (!sampled) return;
    setSampledColor(sampled);
    syncLocalHex(sampled);
  };

  const handleUseDetectedColor = () => {
    if (!detectedColor) return;
    if (colorTimerRef.current) {
      clearTimeout(colorTimerRef.current);
      colorTimerRef.current = null;
      pendingColorRef.current = null;
    }
    const normalized = normalizeColorInput(detectedColor) || detectedColor.toUpperCase();
    setLocalColor(normalized);
    setHexInput(normalized.replace('#', ''));
    if (onUseDetectedColor) onUseDetectedColor();
    else onChangeColor?.(normalized);
  };

  const displayColor = localColor || blurColor || '#F5F5F5';

  return createPortal(
    <div
      data-slot="blur-modal-backdrop"
      data-unstyled={isUnstyled || undefined}
      className={cls('iuk-modal-backdrop')}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        data-slot="blur-modal"
        className={cls('iuk-blur-modal')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cls('iuk-blur-modal__header')}>
          <div className={cls('iuk-blur-modal__title-row')}>
            <Eye size={20} className={cls('iuk-blur-modal__title-icon')} />
            <h2 id={titleId} className={cls('iuk-blur-modal__title')}>{tModal.title}</h2>
            {optimizedSize ? <span className={cls('iuk-badge')}>{formatFileSize(optimizedSize)}</span> : null}
          </div>
          <button type="button" onClick={handleClose} className={cls('iuk-icon-btn')} aria-label={tModal.closeModal}>
            <X size={18} />
          </button>
        </div>

        <div className={cls('iuk-blur-modal__body')}>
          <div className={cls('iuk-blur-modal__grid')}>
            <BlurColorControls
              localColor={localColor} hexInput={hexInput} penModeActive={penModeActive}
              detectedColor={detectedColor} sampledColor={sampledColor} tModal={tModal}
              onColorPickerChange={handleColorPickerChange}
              onHexInputChange={handleHexInputChange}
              onTogglePenMode={() => setPenModeActive((prev) => !prev)}
              onUseDetectedColor={handleUseDetectedColor}
            />

            <div className={cls('iuk-blur-modal__preview-col')}>
              <h3 className={cls('iuk-blur-modal__section-title')}>{tModal.livePreview}</h3>
              <div
                className={cls(`iuk-blur-modal__stage ${penModeActive ? 'iuk-blur-modal__stage--sampling' : ''}`.trim())}
                style={{ backgroundColor: displayColor }}
                onPointerDown={handlePenSample}
              >
                <BlurImage
                  src={imageUrl} alt={altText || tModal.livePreview}
                  blurDataUrl={blurDataUrl} blurColor={displayColor}
                  objectFit="contain" renderImage={renderImage}
                  onImageLoad={(img) => { if (img) drawImageToCanvas(img, liveCanvasRef); }}
                />
                {!blurDataUrl && <div className={cls('iuk-blur-modal__no-blur-note')}>{tModal.showingOriginal}</div>}
              </div>

              {optimizedSize && originalSize && originalSize > optimizedSize ? (
                <div className={cls('iuk-blur-modal__savings')}>
                  <span>{tModal.saved}</span>
                  <strong>
                    {formatFileSize(originalSize - optimizedSize)} (
                    {Math.round(((originalSize - optimizedSize) / originalSize) * 100)}%)
                  </strong>
                </div>
              ) : null}
            </div>
          </div>

          <div className={cls('iuk-blur-modal__alt-section')}>
            <label htmlFor={textareaId} className={cls('iuk-blur-modal__section-title')}>
              {tModal.accessibility} — {tModal.altText}
            </label>
            <textarea
              id={textareaId}
              value={localAltText}
              onChange={(e) => { setLocalAltText(e.target.value); scheduleAltEmit(e.target.value); }}
              className={cls('iuk-blur-modal__textarea')}
              placeholder={tModal.altTextPlaceholder}
              rows={2}
            />
          </div>

          <canvas ref={liveCanvasRef} style={{ display: 'none' }} aria-hidden="true" />
        </div>

        <div className={cls('iuk-blur-modal__footer')}>
          <SaveButton unstyled={isUnstyled} onClick={handleClose}>{tModal.saveAndClose}</SaveButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default BlurVisualizationModal;
