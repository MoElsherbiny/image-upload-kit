import sharp from 'sharp';
import { hexToRgb, rgbToHex } from '../../utils/color';
import { extractEnhancedColorFromBuffer } from './colorHistogram';
import {
  EDGE_COLOR_FALLBACK,
  EDGE_WHITE_FALLBACK,
  type EdgeColorSet,
  type EdgeKey,
  WHITE_DOMINANCE_RATIO,
} from './types';

export async function extractEdgeColorsFromBuffer(
  buffer: Buffer,
): Promise<EdgeColorSet> {
  try {
    const sample = await sharp(buffer)
      .resize(400, 400, {
        fit: 'inside',
        kernel: 'lanczos3',
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return computeEdgeColorSet(
      sample.data,
      sample.info.width,
      sample.info.height,
    );
  } catch {
    try {
      const fallback = await extractEnhancedColorFromBuffer(buffer, 'edge');
      return {
        top: fallback,
        right: fallback,
        bottom: fallback,
        left: fallback,
      };
    } catch {
      return {
        top: EDGE_COLOR_FALLBACK,
        right: EDGE_COLOR_FALLBACK,
        bottom: EDGE_COLOR_FALLBACK,
        left: EDGE_COLOR_FALLBACK,
      };
    }
  }
}

function computeEdgeColorSet(
  data: Buffer,
  width: number,
  height: number,
): EdgeColorSet {
  const thicknessX = Math.max(2, Math.floor(width * 0.12));
  const thicknessY = Math.max(2, Math.floor(height * 0.12));
  const bucketSize = 16;

  const edgeMaps: Record<EdgeKey, Map<string, number>> = {
    top: new Map(),
    right: new Map(),
    bottom: new Map(),
    left: new Map(),
  };

  const whiteEdgeStrength: Record<EdgeKey, number> = {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  const accumulateEdgeSample = (
    edge: EdgeKey,
    weight: number,
    key: string,
    isWhiteSample: boolean,
  ) => {
    if (weight <= 0) return;
    if (isWhiteSample) {
      whiteEdgeStrength[edge] += weight;
      return;
    }
    edgeMaps[edge].set(key, (edgeMaps[edge].get(key) || 0) + weight);
  };

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];

    if (alpha !== undefined && alpha < 8) continue;

    const brightness = (r + g + b) / 3;
    if (brightness < 12) continue;

    const isNearWhite = r >= 245 && g >= 245 && b >= 245;

    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    const bucketR = Math.floor(r / bucketSize) * bucketSize;
    const bucketG = Math.floor(g / bucketSize) * bucketSize;
    const bucketB = Math.floor(b / bucketSize) * bucketSize;
    const key = `${bucketR},${bucketG},${bucketB}`;

    const topWeight = y < thicknessY ? 1 + (thicknessY - y) / thicknessY : 0;
    if (topWeight > 0) {
      accumulateEdgeSample('top', topWeight, key, isNearWhite);
    }

    const bottomWeight =
      y >= height - thicknessY
        ? 1 + (y - (height - thicknessY)) / thicknessY
        : 0;
    if (bottomWeight > 0) {
      accumulateEdgeSample('bottom', bottomWeight, key, isNearWhite);
    }

    const leftWeight = x < thicknessX ? 1 + (thicknessX - x) / thicknessX : 0;
    if (leftWeight > 0) {
      accumulateEdgeSample('left', leftWeight, key, isNearWhite);
    }

    const rightWeight =
      x >= width - thicknessX
        ? 1 + (x - (width - thicknessX)) / thicknessX
        : 0;
    if (rightWeight > 0) {
      accumulateEdgeSample('right', rightWeight, key, isNearWhite);
    }
  }

  return {
    top: resolveEdgeColor(edgeMaps.top, whiteEdgeStrength.top),
    right: resolveEdgeColor(edgeMaps.right, whiteEdgeStrength.right),
    bottom: resolveEdgeColor(edgeMaps.bottom, whiteEdgeStrength.bottom),
    left: resolveEdgeColor(edgeMaps.left, whiteEdgeStrength.left),
  };
}

function resolveEdgeColor(
  map: Map<string, number>,
  whiteStrength: number,
): string {
  if (!map.size) {
    return whiteStrength > 0 ? EDGE_WHITE_FALLBACK : EDGE_COLOR_FALLBACK;
  }

  let dominantColor = '';
  let maxCount = 0;
  let totalColorWeight = 0;

  map.forEach((count, color) => {
    totalColorWeight += count;
    if (count > maxCount) {
      maxCount = count;
      dominantColor = color;
    }
  });

  if (!dominantColor) {
    return whiteStrength > 0 ? EDGE_WHITE_FALLBACK : EDGE_COLOR_FALLBACK;
  }

  const whiteDominates =
    whiteStrength > 0 &&
    (totalColorWeight === 0 ||
      whiteStrength >= totalColorWeight * WHITE_DOMINANCE_RATIO);

  if (whiteDominates) {
    return EDGE_WHITE_FALLBACK;
  }

  if (dominantColor.startsWith('#')) {
    return dominantColor.toUpperCase();
  }

  const [r, g, b] = dominantColor.split(',').map(Number);
  return rgbToHex(r, g, b);
}

export function blendEdgeColors(edgeColors: EdgeColorSet): string {
  const colors = Object.values(edgeColors);
  if (!colors.length) {
    return EDGE_COLOR_FALLBACK;
  }

  const totals = colors.reduce(
    (acc, hex) => {
      const { r, g, b } = hexToRgb(hex || EDGE_COLOR_FALLBACK);
      acc.r += r;
      acc.g += g;
      acc.b += b;
      return acc;
    },
    { r: 0, g: 0, b: 0 },
  );

  const count = colors.length;
  return rgbToHex(totals.r / count, totals.g / count, totals.b / count);
}
