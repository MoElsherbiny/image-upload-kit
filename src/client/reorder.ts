/**
 * Pure immutable array reorder helper for e-commerce product galleries
 * and social carousel editors.
 * Clamps out-of-range indices to `[0, items.length - 1]` and returns a new array
 * (or a shallow copy when `fromIndex` and `toIndex` resolve to the same position).
 */
export function moveItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const len = items.length;
  if (len <= 1) return [...items];

  const clampedFrom = Math.max(0, Math.min(len - 1, Math.trunc(fromIndex)));
  const clampedTo = Math.max(0, Math.min(len - 1, Math.trunc(toIndex)));
  if (clampedFrom === clampedTo) {
    return [...items];
  }

  const next = [...items];
  const [moved] = next.splice(clampedFrom, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/**
 * Promotes the item at `index` to position `0` (the primary cover image).
 */
export function promoteToCover<T>(items: readonly T[], index: number): T[] {
  return moveItem(items, index, 0);
}

export const reorderItems = moveItem;
export const promoteToPrimary = promoteToCover;
