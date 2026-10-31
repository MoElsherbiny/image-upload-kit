import { describe, expect, it, vi } from 'vitest';
import type { ImagePreview } from '../src/react/types';
import type { UploadedImageData } from '../src/types';

function makeImage(id: string, url: string): UploadedImageData {
  return {
    url, blurDataUrl: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
    blurColor: '#4F46E5', altText: `Alt for ${id}`, width: 800, height: 600,
    format: 'webp', size: 24000, originalSize: 80000, contentHash: `hash-${id}`,
    uploadedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Adversarial Scenario 1: Controlled Multi-Image State Desync', () => {
  function mapUploadedToPreview(img: UploadedImageData, prev?: ImagePreview): ImagePreview {
    const altText = prev?.altText && !img.altText?.trim() ? prev.altText : img.altText;
    return {
      id: img.url, url: img.url, file: null, uploadMessage: null,
      originalSize: img.originalSize, optimizedSize: img.size,
      data: { ...img, altText }, altText, blurColor: img.blurColor || prev?.blurColor,
    };
  }

  function syncValue(current: ImagePreview[], value: UploadedImageData[]): ImagePreview[] {
    const prevMap = new Map<string, ImagePreview>();
    current.forEach((p) => {
      prevMap.set(p.id, p);
      if (p.url) prevMap.set(p.url, p);
    });
    const synced = value.map((img) => mapUploadedToPreview(img, prevMap.get(img.url)));
    const pending = current.filter(
      (p) =>
        !value.some((img) => img.url === p.id || (p.url && img.url === p.url)) &&
        (p.isUploading || Boolean(p.error)),
    );
    const next = [...synced, ...pending];
    const isSame =
      next.length === current.length &&
      next.every((it, idx) => {
        const p = current[idx];
        return p && p.id === it.id && p.url === it.url && p.altText === it.altText &&
          p.blurColor === it.blurColor && p.isUploading === it.isUploading;
      });
    return isSame ? current : next;
  }

  it('rapidly mutates value: removes, adds, and clears without ghost items', () => {
    const imgA = makeImage('A', 'https://cdn.example.com/a.webp');
    const imgB = makeImage('B', 'https://cdn.example.com/b.webp');
    const imgC = makeImage('C', 'https://cdn.example.com/c.webp');
    const imgD = makeImage('D', 'https://cdn.example.com/d.webp');

    let state = syncValue([], [imgA, imgB, imgC]);
    expect(state).toHaveLength(3);
    expect(state.map((p) => p.id)).toEqual([imgA.url, imgB.url, imgC.url]);

    state = syncValue(state, [imgA, imgC]);
    expect(state).toHaveLength(2);
    expect(state.some((p) => p.id === imgB.url)).toBe(false);

    state = syncValue(state, [imgA, imgC, imgD]);
    expect(state).toHaveLength(3);
    expect(state[2].id).toBe(imgD.url);

    state = syncValue(state, []);
    expect(state).toHaveLength(0);

    state = syncValue(state, [imgB]);
    expect(state).toHaveLength(1);
    expect(state[0].id).toBe(imgB.url);
    expect(state.some((p) => p.id === imgA.url)).toBe(false);
  });

  it('preserves in-flight uploads and failed items when value updates', () => {
    const imgA = makeImage('A', 'https://cdn.example.com/a.webp');
    const inFlight: ImagePreview = {
      id: 'temp-inflight-1', url: 'blob:inflight', file: null,
      uploadMessage: 'Uploading...', isUploading: true, progress: 40,
    };
    const failedItem: ImagePreview = {
      id: 'temp-failed-1', url: 'blob:failed', file: null,
      uploadMessage: null, error: 'Network 500', isUploading: false,
    };

    let state = syncValue([], [imgA]);
    state = [...state, inFlight, failedItem];
    expect(state).toHaveLength(3);

    const imgE = makeImage('E', 'https://cdn.example.com/e.webp');
    state = syncValue(state, [imgE]);

    expect(state).toHaveLength(3);
    expect(state.some((p) => p.id === imgA.url)).toBe(false);
    expect(state.some((p) => p.id === imgE.url)).toBe(true);
    expect(state.some((p) => p.id === 'temp-inflight-1')).toBe(true);
    expect(state.some((p) => p.id === 'temp-failed-1')).toBe(true);
  });
});

describe('Adversarial Scenario 2: Controlled Single-Image Null Challenge', () => {
  it('strictly resets preview, uploadedData, blurDataUrlState, and sizeInfo on null', () => {
    const img = makeImage('1', 'https://cdn.example.com/photo.webp');
    let preview: string | null = img.url;
    let uploadedData: UploadedImageData | null = img;
    let blurDataUrlState = img.blurDataUrl;
    let sizeInfo: { original: number; optimized: number } | null = { original: 80000, optimized: 24000 };
    let selectedFile: File | null = {} as File;

    const handleValueTransition = (nextValue: UploadedImageData | null | string) => {
      const incomingObj = typeof nextValue === 'object' && nextValue ? nextValue : null;
      const nextPreview = typeof nextValue === 'string' ? nextValue : incomingObj?.url || null;
      preview = nextPreview;
      blurDataUrlState = incomingObj?.blurDataUrl || '';

      if (!nextValue) {
        uploadedData = null;
        blurDataUrlState = '';
        sizeInfo = null;
        selectedFile = null;
      } else if (incomingObj?.url) {
        uploadedData = incomingObj;
      }
    };

    expect(preview).toBe(img.url);
    expect(uploadedData).not.toBeNull();
    handleValueTransition(null);

    expect(preview).toBeNull();
    expect(uploadedData).toBeNull();
    expect(blurDataUrlState).toBe('');
    expect(sizeInfo).toBeNull();
    expect(selectedFile).toBeNull();
  });
});

describe('Adversarial Scenario 3: Timer Unmount Safety', () => {
  it('clears active interval and pending timeouts on unmount and prevents state updates', async () => {
    vi.useFakeTimers();
    let isMounted = true;
    let activeInterval: ReturnType<typeof setInterval> | null = null;
    const timeouts = new Set<ReturnType<typeof setTimeout>>();
    let progressState = 0;
    let uploadMessageState = '';
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const clearProgressInterval = () => {
      if (activeInterval) {
        clearInterval(activeInterval);
        activeInterval = null;
      }
    };
    const clearAllTimeouts = () => {
      timeouts.forEach((t) => clearTimeout(t));
      timeouts.clear();
    };
    const safeSetTimeout = (fn: () => void, ms: number) => {
      const handle = setTimeout(() => {
        timeouts.delete(handle);
        if (isMounted) fn();
      }, ms);
      timeouts.add(handle);
      return handle;
    };

    activeInterval = setInterval(() => {
      if (!isMounted) { clearProgressInterval(); return; }
      progressState = Math.min(progressState + 6, 92);
    }, 50);

    safeSetTimeout(() => { uploadMessageState = 'timeout finished'; }, 500);

    vi.advanceTimersByTime(120);
    expect(progressState).toBeGreaterThan(0);
    expect(activeInterval).not.toBeNull();
    expect(timeouts.size).toBe(1);

    isMounted = false;
    clearProgressInterval();
    clearAllTimeouts();

    expect(activeInterval).toBeNull();
    expect(timeouts.size).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(uploadMessageState).toBe('');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe('Adversarial Scenario 4: Headless Prop Getters & Accessibility', () => {
  interface MockDropzoneEvent {
    key?: string;
    defaultPrevented: boolean;
    preventDefault: () => void;
  }
  interface DropzoneOverrides {
    className?: string;
    role?: string;
    tabIndex?: number;
    'aria-label'?: string;
    onClick?: (e: MockDropzoneEvent) => void;
    onKeyDown?: (e: MockDropzoneEvent) => void;
  }

  it('merges custom overrides, handles keyboard triggers, and prevents default when intercepted', () => {
    let fileDialogOpened = false;
    const openFileDialog = () => { fileDialogOpened = true; };

    const getDropzoneProps = (overrides?: DropzoneOverrides) => ({
      ...overrides,
      role: overrides?.role ?? 'button',
      tabIndex: overrides?.tabIndex ?? 0,
      'aria-label': overrides?.['aria-label'] ?? 'Upload image',
      'data-state': 'idle',
      onClick: (e: MockDropzoneEvent) => {
        overrides?.onClick?.(e);
        if (!e.defaultPrevented) openFileDialog();
      },
      onKeyDown: (e: MockDropzoneEvent) => {
        overrides?.onKeyDown?.(e);
        if (!e.defaultPrevented && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openFileDialog();
        }
      },
    });

    const defaultProps = getDropzoneProps();
    expect(defaultProps.role).toBe('button');
    expect(defaultProps.tabIndex).toBe(0);

    const customProps = getDropzoneProps({
      className: 'my-dropzone', role: 'region', tabIndex: 2, 'aria-label': 'Custom Dropzone',
    });
    expect(customProps.className).toBe('my-dropzone');
    expect(customProps.role).toBe('region');
    expect(customProps.tabIndex).toBe(2);

    fileDialogOpened = false;
    const enterEvt = { key: 'Enter', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    defaultProps.onKeyDown(enterEvt);
    expect(fileDialogOpened).toBe(true);

    fileDialogOpened = false;
    const spaceEvt = { key: ' ', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    defaultProps.onKeyDown(spaceEvt);
    expect(fileDialogOpened).toBe(true);

    fileDialogOpened = false;
    const interceptedProps = getDropzoneProps({ onClick: (e: MockDropzoneEvent) => e.preventDefault() });
    const clickEvt = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    interceptedProps.onClick(clickEvt);
    expect(fileDialogOpened).toBe(false);
  });

  it('verifies hidden input clip styling and click stopPropagation', () => {
    interface MockClickEvt { stopPropagation: () => void; }
    interface InputOverrides { style?: Record<string, string | number>; onClick?: (e: MockClickEvt) => void; }
    let propagationStopped = false;
    const getInputProps = (overrides?: InputOverrides) => ({
      ...overrides,
      type: 'file',
      style: { position: 'absolute', clip: 'rect(0, 0, 0, 0)', ...overrides?.style } as Record<string, string | number>,
      onClick: (e: MockClickEvt) => {
        overrides?.onClick?.(e);
        e.stopPropagation();
      },
    });

    const inProps = getInputProps({ style: { zIndex: 5 } });
    expect(inProps.type).toBe('file');
    expect(inProps.style.clip).toBe('rect(0, 0, 0, 0)');
    expect(inProps.style.zIndex).toBe(5);

    inProps.onClick({ stopPropagation: () => { propagationStopped = true; } });
    expect(propagationStopped).toBe(true);
  });
});
