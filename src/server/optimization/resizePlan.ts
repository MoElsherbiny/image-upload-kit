import type { ImageDimensions } from '../../types';
import {
  type CropStrategy,
  type ImageAspectRatio,
  resolveAspectRatio,
} from '../../types/aspectRatio';

export interface CoverResizePlan {
  width: number;
  height: number;
  fit: 'cover';
  position: CropStrategy;
}

export interface InsideResizePlan {
  width: number;
  height: number;
  fit: 'inside';
  withoutEnlargement: true;
}

export type ResizePlan = CoverResizePlan | InsideResizePlan;

export interface BuildResizePlanOptions {
  source?: { width?: number; height?: number };
  width?: number;
  height?: number;
  maxDimensions: ImageDimensions;
  aspectRatio?: ImageAspectRatio;
  crop?: CropStrategy;
}

export function needsAspectCrop(
  srcWidth: number | undefined,
  srcHeight: number | undefined,
  aspectRatio: ImageAspectRatio | undefined,
): boolean {
  const r = resolveAspectRatio(aspectRatio);
  if (r === undefined) return false;
  if (!srcWidth || !srcHeight || srcWidth <= 0 || srcHeight <= 0) return true;
  return Math.abs(srcWidth / srcHeight - r) > 0.01;
}

export function buildResizePlan(
  sourceOrOptions:
    | { width?: number; height?: number }
    | BuildResizePlanOptions,
  maxDimensionsArg?: ImageDimensions,
  aspectRatioArg?: ImageAspectRatio,
  cropArg?: CropStrategy,
): ResizePlan {
  const isOptionsObj =
    maxDimensionsArg === undefined &&
    'maxDimensions' in sourceOrOptions &&
    Boolean(sourceOrOptions.maxDimensions);

  const srcWidth = isOptionsObj
    ? ((sourceOrOptions as BuildResizePlanOptions).source?.width ??
      (sourceOrOptions as BuildResizePlanOptions).width)
    : (sourceOrOptions as { width?: number; height?: number }).width;
  const srcHeight = isOptionsObj
    ? ((sourceOrOptions as BuildResizePlanOptions).source?.height ??
      (sourceOrOptions as BuildResizePlanOptions).height)
    : (sourceOrOptions as { width?: number; height?: number }).height;
  const maxDimensions = isOptionsObj
    ? (sourceOrOptions as BuildResizePlanOptions).maxDimensions
    : maxDimensionsArg!;
  const aspectRatio = isOptionsObj
    ? (sourceOrOptions as BuildResizePlanOptions).aspectRatio
    : aspectRatioArg;
  const crop = isOptionsObj
    ? (sourceOrOptions as BuildResizePlanOptions).crop
    : cropArg;

  const r = resolveAspectRatio(aspectRatio);
  if (r === undefined) {
    return {
      width: maxDimensions.width,
      height: maxDimensions.height,
      fit: 'inside' as const,
      withoutEnlargement: true,
    };
  }

  const boundWidth =
    srcWidth && srcWidth > 0
      ? Math.min(srcWidth, maxDimensions.width)
      : maxDimensions.width;
  const boundHeight =
    srcHeight && srcHeight > 0
      ? Math.min(srcHeight, maxDimensions.height)
      : maxDimensions.height;

  let targetWidth: number;
  let targetHeight: number;
  if (r === 1) {
    const side = Math.max(1, Math.round(Math.min(boundWidth, boundHeight)));
    targetWidth = side;
    targetHeight = side;
  } else if (boundWidth / boundHeight > r) {
    targetHeight = Math.max(1, Math.round(boundHeight));
    targetWidth = Math.max(
      1,
      Math.min(Math.round(boundWidth), Math.round(targetHeight * r)),
    );
  } else {
    targetWidth = Math.max(1, Math.round(boundWidth));
    targetHeight = Math.max(
      1,
      Math.min(Math.round(boundHeight), Math.round(targetWidth / r)),
    );
  }

  return {
    width: targetWidth,
    height: targetHeight,
    fit: 'cover' as const,
    position: crop || 'attention',
  };
}
