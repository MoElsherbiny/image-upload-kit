import {
  type CSSProperties,
  Fragment,
  type HTMLAttributes,
  useEffect,
  useRef,
} from 'react';
import type { BlurPlaceholderType } from '../../blur/types';
import { attachPointerReorder } from '../../core/pointerReorder';
import type { UploadLocale } from '../../types';
import type { UploadTranslations } from '../i18n';
import type {
  MultiCustomRenderers,
  MultiUploadSlot,
} from '../styling';
import type { CustomImageRenderer, ImagePreview } from '../types';
import {
  type DropzoneDragHandlers,
  MultiAddMoreTile,
  type MultiDropzoneSlotProps,
} from './MultiDropzoneViews';
import { PreviewTile } from './PreviewTile';

export interface MultiImageGridProps
  extends MultiDropzoneSlotProps,
    Pick<MultiCustomRenderers, 'renderTile' | 'renderAddMore'> {
  previews: ImagePreview[];
  selectedPreviews: Set<string>;
  maxImages: number;
  reorderable: boolean;
  showCoverBadge: boolean;
  disabled: boolean;
  isUploading: boolean;
  isDragging: boolean;
  allowFolder: boolean;
  blurType: BlurPlaceholderType;
  locale: UploadLocale;
  translations?: Partial<UploadTranslations>;
  ui: UploadTranslations;
  renderImage?: CustomImageRenderer;
  dragHandlers: DropzoneDragHandlers;
  dropzoneProps: HTMLAttributes<HTMLElement> & { 'data-state'?: string };
  slotClass: (slot: MultiUploadSlot, defaultClass?: string) => string | undefined;
  slotStyle: (slot: MultiUploadSlot) => CSSProperties | undefined;
  onSelectFiles: () => void;
  onSelectFolder: () => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onSetCover: (index: number) => void;
  onRemove: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onEditAltText: (id: string) => void;
  onChangeAltText: (id: string, altText: string) => void;
  onChangeColor: (id: string, color: string) => void;
}

export function MultiImageGrid({
  previews,
  selectedPreviews,
  maxImages,
  reorderable,
  showCoverBadge,
  disabled,
  isUploading,
  isDragging,
  allowFolder,
  blurType,
  locale,
  translations,
  ui,
  renderImage,
  dragHandlers,
  dropzoneProps,
  slotClass,
  slotStyle,
  onSelectFiles,
  onSelectFolder,
  onMove,
  onSetCover,
  onRemove,
  onCancel,
  onRetry,
  onToggleSelect,
  onEditAltText,
  onChangeAltText,
  onChangeColor,
  renderTile,
  renderAddMore,
  unstyled,
  providerClassNames,
  classNames,
  providerStyles,
  styles,
}: MultiImageGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const disabledRef = useRef(disabled || isUploading);
  disabledRef.current = disabled || isUploading;

  useEffect(() => {
    const gridEl = gridRef.current;
    if (!reorderable || !gridEl) return;
    return attachPointerReorder(gridEl, {
      disabled: () => disabledRef.current,
      onMove: (fromIndex, toIndex) => moveRef.current(fromIndex, toIndex),
    });
  }, [reorderable, previews.length]);

  return (
    <div
      ref={gridRef}
      data-slot="grid"
      className={slotClass('grid', 'iuk-multi__grid')}
      style={slotStyle('grid')}
    >
      {previews.map((item, index) =>
        renderTile ? (
          <Fragment key={item.id}>
            {renderTile({
              item,
              index,
              isCover: index === 0,
              isSelected: selectedPreviews.has(item.id),
              disabled,
              toggleSelect: () => onToggleSelect(item.id),
              remove: () => onRemove(item.id),
              cancel: () => onCancel(item.id),
              retry: () => onRetry(item.id),
              moveEarlier: () => onMove(index, index - 1),
              moveLater: () => onMove(index, index + 1),
              setAsCover: () => onSetCover(index),
              openAltTextModal: () => onEditAltText(item.id),
              setAltText: (altText) => onChangeAltText(item.id, altText),
              setBlurColor: (hex) => onChangeColor(item.id, hex),
              locale,
              ui,
            })}
          </Fragment>
        ) : (
          <PreviewTile
            key={item.id}
            preview={item}
            index={index}
            totalCount={previews.length}
            reorderable={reorderable}
            showCoverBadge={showCoverBadge}
            onMove={onMove}
            onSetCover={onSetCover}
            onRemove={onRemove}
            onCancel={onCancel}
            onRetry={onRetry}
            disabled={disabled}
            blurType={blurType}
            isSelected={selectedPreviews.has(item.id)}
            onToggleSelect={onToggleSelect}
            onEditAltText={onEditAltText}
            onChangeAltText={onChangeAltText}
            onChangeColor={onChangeColor}
            locale={locale}
            translations={translations}
            renderImage={renderImage}
            unstyled={unstyled}
            className={slotClass('tile')}
            style={slotStyle('tile')}
          />
        ),
      )}

      {renderAddMore ? (
        renderAddMore({
          isDragging,
          disabled,
          allowFolder,
          remainingCount: Math.max(0, maxImages - previews.length),
          openFileDialog: onSelectFiles,
          openFolderDialog: onSelectFolder,
          dropzoneProps,
          locale,
          ui,
        })
      ) : (
        <MultiAddMoreTile
          isDragging={isDragging}
          disabled={disabled}
          allowFolder={allowFolder}
          ui={ui}
          dragHandlers={dragHandlers}
          onSelectFiles={onSelectFiles}
          onSelectFolder={onSelectFolder}
          unstyled={unstyled}
          providerClassNames={providerClassNames}
          classNames={classNames}
          providerStyles={providerStyles}
          styles={styles}
        />
      )}
    </div>
  );
}
