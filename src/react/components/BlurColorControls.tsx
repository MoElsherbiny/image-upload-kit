import { PenTool, Wand2 } from 'lucide-react';
import type { ChangeEvent } from 'react';
import type { BlurModalTranslations } from '../i18n';

export interface BlurColorControlsProps {
  localColor: string;
  hexInput: string;
  penModeActive: boolean;
  detectedColor?: string;
  sampledColor: string | null;
  tModal: BlurModalTranslations;
  onColorPickerChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onHexInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTogglePenMode: () => void;
  onUseDetectedColor: () => void;
}

export function BlurColorControls({
  localColor,
  hexInput,
  penModeActive,
  detectedColor,
  sampledColor,
  tModal,
  onColorPickerChange,
  onHexInputChange,
  onTogglePenMode,
  onUseDetectedColor,
}: BlurColorControlsProps) {
  return (
    <div className="iuk-blur-modal__controls">
      <h3 className="iuk-blur-modal__section-title">{tModal.adjustColor}</h3>
      <p className="iuk-blur-modal__subtitle">
        {penModeActive ? `🎨 ${tModal.clickToSample}` : tModal.pickColorNote}
      </p>

      <div className="iuk-blur-modal__picker-row">
        <label className="iuk-blur-modal__color-well">
          <input
            type="color"
            value={localColor}
            onChange={onColorPickerChange}
            aria-label={tModal.adjustColor}
          />
        </label>

        <div className="iuk-blur-modal__hex-group">
          <div className="iuk-blur-modal__hex-field">
            <span>#</span>
            <input
              type="text"
              value={hexInput}
              onChange={onHexInputChange}
              maxLength={6}
              spellCheck={false}
              aria-label={tModal.enterHexColor}
              placeholder={tModal.hexPlaceholder}
            />
          </div>
          <div className="iuk-blur-modal__swatch-chip">
            <span
              className="iuk-blur-modal__swatch-dot"
              style={{ backgroundColor: localColor }}
              aria-hidden="true"
            />
            <code>{localColor}</code>
          </div>
        </div>
      </div>

      <div className="iuk-blur-modal__actions-row">
        <button
          type="button"
          onClick={onTogglePenMode}
          className={`iuk-btn iuk-btn--secondary ${penModeActive ? 'iuk-btn--active' : ''}`}
          aria-label={
            penModeActive ? tModal.disablePenMode : tModal.enablePenMode
          }
        >
          <PenTool size={14} />
          <span>
            {penModeActive ? tModal.penModeActive : tModal.enablePenMode}
          </span>
        </button>

        {detectedColor && (
          <button
            type="button"
            className="iuk-btn iuk-btn--secondary"
            onClick={onUseDetectedColor}
          >
            <Wand2 size={14} />
            <span>{tModal.resetToDetected}</span>
            <code>{detectedColor.toUpperCase()}</code>
          </button>
        )}

        {sampledColor && (
          <span className="iuk-badge iuk-badge--accent">
            <PenTool size={12} />
            <span>
              {tModal.sampled} {sampledColor}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
