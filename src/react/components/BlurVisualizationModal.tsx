import { Eye, X } from 'lucide-react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UploadLocale } from '../../types';
import { normalizeColorInput } from '../../utils/color';
import { formatFileSize } from '../../utils/formatters';
import { useImageUploadContext } from '../context';
import { normalizeUploadLocale, resolveTranslations, type UploadTranslations } from '../i18n';
import type { CustomImageRenderer } from '../types';
import { drawImageToCanvas, sampleCanvasPixelHex } from '../utils/canvasSampler';
import { BlurColorControls } from './BlurColorControls';
import { BlurImage } from './BlurImage';
import { SaveButton } from './SaveButton';

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
}

export function BlurVisualizationModal({
  isOpen, onClose, imageUrl, blurDataUrl, blurColor, altText,
  originalSize, optimizedSize, detectedColor, onChangeColor,
  onUseDetectedColor, onChangeAltText, locale: propLocale,
  translations, renderImage,
}: BlurVisualizationModalProps) {
  const ctx = useImageUploadContext();
  const locale = normalizeUploadLocale(propLocale || ctx.locale);
  const tModal = resolveTranslations(locale, translations || ctx.translations).blurModal;

  const baseColor = useMemo(() => (blurColor || detectedColor || '#F5F5F5').toUpperCase(), [blurColor, detectedColor]);
  const [localColor, setLocalColor] = useState(baseColor);
  const [hexInput, setHexInput] = useState(baseColor.replace('#', ''));
  const [sampledColor, setSampledColor] = useState<string | null>(null);
  const [penModeActive, setPenModeActive] = useState(false);
  const [localAltText, setLocalAltText] = useState(altText || '');
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      setLocalColor(baseColor);
      setHexInput(baseColor.replace('#', ''));
      setLocalAltText(altText || '');
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, baseColor, altText, blurDataUrl, imageUrl, blurColor]);

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

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const syncLocalHex = (hex: string, notify = true) => {
    setLocalColor(hex);
    setHexInput(hex.replace('#', ''));
    if (notify) onChangeColor?.(hex);
  };

  const handleColorPickerChange = (e: ChangeEvent<HTMLInputElement>) => syncLocalHex(e.target.value.toUpperCase());

  const handleHexInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexInput(sanitized.toUpperCase());
    if (sanitized.length === 3 || sanitized.length === 6) {
      const normalized = normalizeColorInput(`#${sanitized}`);
      if (normalized) {
        setLocalColor(normalized);
        onChangeColor?.(normalized);
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
    onUseDetectedColor?.();
    const normalized = normalizeColorInput(detectedColor);
    if (normalized) syncLocalHex(normalized, false);
  };

  const displayColor = localColor || blurColor || '#F5F5F5';

  return createPortal(
    <div
      className="iuk-modal-backdrop" dir={locale === 'ar' ? 'rtl' : 'ltr'} onClick={onClose}
      role="dialog" aria-modal="true" aria-labelledby="iuk-blur-modal-title"
    >
      <div className="iuk-blur-modal" onClick={(e) => e.stopPropagation()}>
        <div className="iuk-blur-modal__header">
          <div className="iuk-blur-modal__title-row">
            <Eye size={20} className="iuk-blur-modal__title-icon" />
            <h2 id="iuk-blur-modal-title" className="iuk-blur-modal__title">{tModal.title}</h2>
            {optimizedSize ? <span className="iuk-badge">{formatFileSize(optimizedSize)}</span> : null}
          </div>
          <button type="button" onClick={onClose} className="iuk-icon-btn" aria-label={tModal.closeModal}>
            <X size={18} />
          </button>
        </div>

        <div className="iuk-blur-modal__body">
          <div className="iuk-blur-modal__grid">
            <BlurColorControls
              localColor={localColor}
              hexInput={hexInput}
              penModeActive={penModeActive}
              detectedColor={detectedColor}
              sampledColor={sampledColor}
              tModal={tModal}
              onColorPickerChange={handleColorPickerChange}
              onHexInputChange={handleHexInputChange}
              onTogglePenMode={() => setPenModeActive((prev) => !prev)}
              onUseDetectedColor={handleUseDetectedColor}
            />

            <div className="iuk-blur-modal__preview-col">
              <h3 className="iuk-blur-modal__section-title">{tModal.livePreview}</h3>
              <div
                className={`iuk-blur-modal__stage ${penModeActive ? 'iuk-blur-modal__stage--sampling' : ''}`}
                style={{ backgroundColor: displayColor }}
                onPointerDown={handlePenSample}
              >
                <BlurImage
                  src={imageUrl}
                  alt={altText || tModal.livePreview}
                  blurDataUrl={blurDataUrl}
                  blurColor={displayColor}
                  objectFit="contain"
                  renderImage={renderImage}
                  onImageLoad={(img) => { if (img) drawImageToCanvas(img, liveCanvasRef); }}
                />
                {!blurDataUrl && <div className="iuk-blur-modal__no-blur-note">{tModal.showingOriginal}</div>}
              </div>

              {optimizedSize && originalSize && originalSize > optimizedSize ? (
                <div className="iuk-blur-modal__savings">
                  <span>{tModal.saved}</span>
                  <strong>
                    {formatFileSize(originalSize - optimizedSize)} (
                    {Math.round(((originalSize - optimizedSize) / originalSize) * 100)}%)
                  </strong>
                </div>
              ) : null}
            </div>
          </div>

          <div className="iuk-blur-modal__alt-section">
            <label htmlFor="iuk-modal-alt-textarea" className="iuk-blur-modal__section-title">
              {tModal.accessibility} — {tModal.altText}
            </label>
            <textarea
              id="iuk-modal-alt-textarea"
              value={localAltText}
              onChange={(e) => { setLocalAltText(e.target.value); onChangeAltText?.(e.target.value); }}
              className="iuk-blur-modal__textarea"
              placeholder={tModal.altTextPlaceholder}
              rows={2}
            />
          </div>

          <canvas ref={liveCanvasRef} style={{ display: 'none' }} aria-hidden="true" />
        </div>

        <div className="iuk-blur-modal__footer">
          <SaveButton onClick={onClose}>{tModal.saveAndClose}</SaveButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default BlurVisualizationModal;
