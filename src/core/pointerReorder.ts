export interface PointerReorderState {
  dragging: boolean;
  fromIndex?: number;
  overIndex?: number;
}

export interface AttachPointerReorderOptions {
  /** Selector for reorderable tile elements inside the container. Defaults to `'[data-index]'`. */
  itemSelector?: string;
  /** Optional handle selector; when omitted or matched, dragging can start from the handle or tile. */
  handleSelector?: string;
  /** Minimum pointer travel in px before activating drag. Defaults to `6`. */
  dragThresholdPx?: number;
  /** Dynamic check for whether reordering is currently disabled. */
  disabled?: () => boolean;
  /** Callback invoked when a tile is dropped onto a new index. */
  onMove: (fromIndex: number, toIndex: number) => void;
  /** Optional callback invoked when drag state changes. */
  onDragStateChange?: (state: PointerReorderState) => void;
}

/**
 * Framework-agnostic pointer-events drag-and-drop gallery reorder enhancer.
 * Works across React, Vue, and Angular grids alongside accessible Move/Cover buttons
 * and `Alt+ArrowLeft/Right` keyboard shortcuts (WCAG 2.5.7 compliant).
 */
export function attachPointerReorder(
  container: HTMLElement,
  options: AttachPointerReorderOptions,
): () => void {
  const itemSelector = options.itemSelector ?? '[data-index]';
  const handleSelector =
    options.handleSelector ?? '[data-slot="tile-drag-handle"]';
  const threshold = options.dragThresholdPx ?? 6;

  let activePointerId: number | null = null;
  let fromIndex: number | null = null;
  let overIndex: number | null = null;
  let startX = 0;
  let startY = 0;
  let isDragging = false;
  let draggedEl: HTMLElement | null = null;

  const clearDomMarkers = () => {
    container.removeAttribute('data-reordering');
    const items = container.querySelectorAll<HTMLElement>(itemSelector);
    for (let i = 0; i < items.length; i++) {
      items[i].removeAttribute('data-dragging');
      items[i].removeAttribute('data-drop-target');
    }
  };

  const resetDrag = (commit: boolean) => {
    const finalFrom = fromIndex;
    const finalOver = overIndex;
    const wasDragging = isDragging;

    if (
      draggedEl &&
      activePointerId !== null &&
      typeof draggedEl.releasePointerCapture === 'function'
    ) {
      try {
        draggedEl.releasePointerCapture(activePointerId);
      } catch {
        // Ignore capture release errors in synthetic environments
      }
    }

    activePointerId = null;
    fromIndex = null;
    overIndex = null;
    isDragging = false;
    draggedEl = null;
    clearDomMarkers();

    if (wasDragging) {
      options.onDragStateChange?.({ dragging: false });
      if (
        commit &&
        finalFrom !== null &&
        finalOver !== null &&
        finalFrom !== finalOver
      ) {
        options.onMove(finalFrom, finalOver);
      }
    }
  };

  const resolveTileFromNode = (node: EventTarget | null): HTMLElement | null => {
    if (!node || !(node instanceof HTMLElement)) return null;
    const tile = node.closest<HTMLElement>(itemSelector);
    if (!tile || !container.contains(tile)) return null;
    return tile;
  };

  const parseTileIndex = (tile: HTMLElement | null): number | null => {
    if (!tile) return null;
    const raw = tile.getAttribute('data-index');
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const findTargetTileAtPoint = (
    clientX: number,
    clientY: number,
    fallbackTarget: EventTarget | null,
  ): HTMLElement | null => {
    if (
      typeof document !== 'undefined' &&
      typeof document.elementFromPoint === 'function'
    ) {
      const hit = document.elementFromPoint(clientX, clientY);
      const tile = resolveTileFromNode(hit);
      if (tile) return tile;
    }
    const items = container.querySelectorAll<HTMLElement>(itemSelector);
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return items[i];
      }
    }
    return resolveTileFromNode(fallbackTarget);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (options.disabled?.() || e.button > 0) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const handle = target.closest(handleSelector);
    if (!handle) {
      const interactive = target.closest(
        'button, input, a, select, textarea, [role="button"], [role="checkbox"]',
      );
      if (interactive && interactive !== target.closest(itemSelector)) {
        return;
      }
    }

    const tile = resolveTileFromNode(target);
    const idx = parseTileIndex(tile);
    if (!tile || idx === null) return;

    activePointerId = e.pointerId;
    fromIndex = idx;
    overIndex = idx;
    startX = e.clientX;
    startY = e.clientY;
    draggedEl = tile;

    if (handle) {
      isDragging = true;
      container.setAttribute('data-reordering', 'true');
      tile.setAttribute('data-dragging', 'true');
      tile.setAttribute('data-drop-target', 'true');
      if (typeof tile.setPointerCapture === 'function') {
        try {
          tile.setPointerCapture(e.pointerId);
        } catch {
          // Ignore in jsdom
        }
      }
      options.onDragStateChange?.({
        dragging: true,
        fromIndex: idx,
        overIndex: idx,
      });
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    if (options.disabled?.() || fromIndex === null || !draggedEl) {
      resetDrag(false);
      return;
    }

    if (!isDragging) {
      const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (dist < threshold) return;
      isDragging = true;
      container.setAttribute('data-reordering', 'true');
      draggedEl.setAttribute('data-dragging', 'true');
    }

    const targetTile = findTargetTileAtPoint(e.clientX, e.clientY, e.target);
    const targetIdx = parseTileIndex(targetTile);
    if (targetIdx !== null && targetIdx !== overIndex) {
      overIndex = targetIdx;
      const items = container.querySelectorAll<HTMLElement>(itemSelector);
      for (let i = 0; i < items.length; i++) {
        if (parseTileIndex(items[i]) === targetIdx) {
          items[i].setAttribute('data-drop-target', 'true');
        } else {
          items[i].removeAttribute('data-drop-target');
        }
      }
      options.onDragStateChange?.({
        dragging: true,
        fromIndex,
        overIndex: targetIdx,
      });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const targetTile = findTargetTileAtPoint(e.clientX, e.clientY, e.target);
    const targetIdx = parseTileIndex(targetTile);
    if (targetIdx !== null) {
      overIndex = targetIdx;
    }
    resetDrag(true);
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    resetDrag(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isDragging) {
      e.preventDefault();
      resetDrag(false);
    }
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('keydown', onKeyDown);

  return () => {
    resetDrag(false);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerCancel);
    container.removeEventListener('keydown', onKeyDown);
  };
}
