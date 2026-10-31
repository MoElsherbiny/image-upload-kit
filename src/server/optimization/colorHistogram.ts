import sharp from 'sharp';
import { rgbToHex } from '../../utils/color';
import {
  type ColorSamplingMode,
  EDGE_COLOR_FALLBACK,
  EDGE_WHITE_FALLBACK,
  WHITE_DOMINANCE_RATIO,
} from './types';

export async function extractEnhancedColorFromBuffer(
  buffer: Buffer,
  mode: ColorSamplingMode = 'balanced',
): Promise<string> {
  try {
    const metadata = await sharp(buffer).metadata();
    const maxSize = 400;
    const needsResize =
      metadata.width &&
      metadata.height &&
      (metadata.width > maxSize || metadata.height > maxSize);

    if (needsResize) {
      const resized = await sharp(buffer)
        .resize(maxSize, maxSize, {
          fit: 'inside',
          kernel: 'lanczos3',
          withoutEnlargement: true,
        })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      return extractDominantColorHistogramAdvanced(
        resized.data,
        resized.info.width,
        resized.info.height,
        mode,
      );
    }

    const raw = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return extractDominantColorHistogramAdvanced(
      raw.data,
      raw.info.width,
      raw.info.height,
      mode,
    );
  } catch {
    const stats = await sharp(buffer)
      .resize(64, 64, { fit: 'cover', kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return extractDominantColorHistogram(stats.data);
  }
}

function extractDominantColorHistogramAdvanced(
  data: Buffer,
  width: number,
  height: number,
  mode: ColorSamplingMode,
): string {
  const colorMap = new Map<string, number>();
  const bucketSize = 16;

  const centerWeight = 1.5;
  const centerX = width / 2 || 1;
  const centerY = height / 2 || 1;
  let whiteWeight = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha !== undefined && alpha < 8) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;
    if (brightness < 10) continue;

    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const dx = (x - centerX) / centerX;
    const dy = (y - centerY) / centerY;
    const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
    let weight = 1.0;

    if (mode === 'edge') {
      const edgeThicknessX = Math.max(1, Math.floor(width * 0.12));
      const edgeThicknessY = Math.max(1, Math.floor(height * 0.12));

      const onLeftEdge = x < edgeThicknessX;
      const onRightEdge = x >= width - edgeThicknessX;
      const onTopEdge = y < edgeThicknessY;
      const onBottomEdge = y >= height - edgeThicknessY;

      if (!(onLeftEdge || onRightEdge || onTopEdge || onBottomEdge)) {
        continue;
      }

      const distanceToNearestEdge = Math.min(
        x,
        y,
        width - 1 - x,
        height - 1 - y,
      );
      const maxEdgeDistance = Math.max(edgeThicknessX, edgeThicknessY) || 1;
      const edgeFactor = 1 - distanceToNearestEdge / maxEdgeDistance;
      weight = 1 + edgeFactor * 3;
    } else {
      weight = distanceFromCenter < 0.5 ? centerWeight : 1.0;
    }

    const isNearWhite = r >= 245 && g >= 245 && b >= 245;
    if (isNearWhite) {
      whiteWeight += weight;
      continue;
    }

    const bucketR = Math.floor(r / bucketSize) * bucketSize;
    const bucketG = Math.floor(g / bucketSize) * bucketSize;
    const bucketB = Math.floor(b / bucketSize) * bucketSize;

    const key = `${bucketR},${bucketG},${bucketB}`;
    colorMap.set(key, (colorMap.get(key) || 0) + weight);
  }

  if (!colorMap.size) {
    return whiteWeight > 0 ? EDGE_WHITE_FALLBACK : EDGE_COLOR_FALLBACK;
  }

  let maxCount = 0;
  let dominantColor = '64,64,80';
  let totalColorWeight = 0;

  colorMap.forEach((count, color) => {
    totalColorWeight += count;
    if (count > maxCount) {
      maxCount = count;
      dominantColor = color;
    }
  });

  const whiteDominates =
    whiteWeight > 0 && whiteWeight >= totalColorWeight * WHITE_DOMINANCE_RATIO;
  if (whiteDominates) {
    return EDGE_WHITE_FALLBACK;
  }

  const [r, g, b] = dominantColor.split(',').map(Number);
  return rgbToHex(r, g, b);
}

function extractDominantColorHistogram(data: Buffer): string {
  const colorMap = new Map<string, number>();
  const bucketSize = 16;
  let whiteWeight = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha !== undefined && alpha < 8) continue;

    const r = Math.floor(data[i] / bucketSize) * bucketSize;
    const g = Math.floor(data[i + 1] / bucketSize) * bucketSize;
    const b = Math.floor(data[i + 2] / bucketSize) * bucketSize;

    if (r >= 240 && g >= 240 && b >= 240) {
      whiteWeight += 1;
      continue;
    }

    const key = `${r},${g},${b}`;
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
  }

  if (!colorMap.size) {
    return whiteWeight > 0 ? EDGE_WHITE_FALLBACK : EDGE_COLOR_FALLBACK;
  }

  let maxCount = 0;
  let dominantColor = '64,64,80';
  let totalColorWeight = 0;

  colorMap.forEach((count, color) => {
    totalColorWeight += count;
    if (count > maxCount) {
      maxCount = count;
      dominantColor = color;
    }
  });

  const whiteDominates =
    whiteWeight > 0 && whiteWeight >= totalColorWeight * WHITE_DOMINANCE_RATIO;
  if (whiteDominates) {
    return EDGE_WHITE_FALLBACK;
  }

  const [r, g, b] = dominantColor.split(',').map(Number);
  return rgbToHex(r, g, b);
}
