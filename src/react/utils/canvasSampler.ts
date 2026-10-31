import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { rgbToHex } from '../../utils/color';

export function drawImageToCanvas(
  img: HTMLImageElement,
  canvasRef: RefObject<HTMLCanvasElement | null>,
): void {
  const canvas = canvasRef.current;
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  try {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } catch {
    // Tainted cross-origin canvas ignored gracefully
  }
}

export function sampleCanvasPixelHex(
  event: ReactPointerEvent<HTMLElement>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
): string | null {
  const canvas = canvasRef.current;
  const context = canvas?.getContext('2d');
  if (!canvas || !context || canvas.width === 0 || canvas.height === 0) {
    return null;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const relX = (event.clientX - rect.left) / rect.width;
  const relY = (event.clientY - rect.top) / rect.height;
  if (relX < 0 || relY < 0 || relX > 1 || relY > 1) return null;

  const x = Math.min(
    Math.max(Math.floor(relX * canvas.width), 0),
    canvas.width - 1,
  );
  const y = Math.min(
    Math.max(Math.floor(relY * canvas.height), 0),
    canvas.height - 1,
  );

  let pixel: Uint8ClampedArray;
  try {
    pixel = context.getImageData(x, y, 1, 1).data;
  } catch {
    return null;
  }

  const [r, g, b, alpha] = pixel;
  if (alpha === 0) return null;

  return rgbToHex(r, g, b);
}
